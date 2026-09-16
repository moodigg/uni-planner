// Offline test suite for the push worker. Run: npm test
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ece from 'http_ece';
import { encryptPayload, vapidJwt, b64urlEncode, b64urlDecode } from '../src/webpush.js';
import { zonedToUtc, zonedParts, isValidTimeZone } from '../src/tz.js';
import worker, { dueClassFirings, runDue, validRules, classTitle, LIMITS } from '../src/index.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
};

/* ---------- 1. payload encryption: decrypt with the reference http_ece library ---------- */
{
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const p256dh = b64urlEncode(ua.getPublicKey());
  const msg = JSON.stringify({ title: 'Operating Systems in 15 min', body: 'Lecture · A202S · 1:30pm — ✓', tag: 'class-c7' });
  const body = await encryptPayload(msg, p256dh, b64urlEncode(auth));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: b64urlEncode(auth) });
  ok('encrypted push decrypts with reference library (aes128gcm)', plain.toString('utf8') === msg, plain.toString('utf8'));
  ok('header: 16-byte salt, rs=4096, 65-byte key id', body.length > 86 && body[20] === 65 &&
    ((body[16] << 24) | (body[17] << 16) | (body[18] << 8) | body[19]) === 4096);
  const body2 = await encryptPayload(msg, p256dh, b64urlEncode(auth));
  ok('fresh salt + ephemeral key per message', Buffer.compare(Buffer.from(body.slice(0, 86)), Buffer.from(body2.slice(0, 86))) !== 0);
  let threw = false;
  try { await encryptPayload(msg, b64urlEncode(crypto.randomBytes(65)), b64urlEncode(auth)); } catch (e) { threw = true; }
  ok('rejects malformed browser key', threw);
}

/* ---------- 2. VAPID JWT verifies with node crypto ---------- */
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const now = Date.now();
  const token = await vapidJwt('https://fcm.googleapis.com', 'https://moodigg.github.io/uni-planner/', JSON.stringify(jwk), now);
  const [h, c, s] = token.split('.');
  const verified = crypto.verify('sha256', Buffer.from(h + '.' + c), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlDecode(s)));
  const claims = JSON.parse(Buffer.from(b64urlDecode(c)).toString());
  const header = JSON.parse(Buffer.from(b64urlDecode(h)).toString());
  ok('VAPID signature verifies (ES256, raw r||s)', verified);
  ok('VAPID header alg ES256', header.alg === 'ES256' && header.typ === 'JWT');
  ok('VAPID claims aud/sub/exp<=24h', claims.aud === 'https://fcm.googleapis.com' && claims.sub.startsWith('https://') &&
    claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600, claims);
}

/* ---------- 3. time zones ---------- */
{
  ok('valid tz accepted / junk rejected', isValidTimeZone('Asia/Dubai') && !isValidTimeZone('Mars/Olympus') && !isValidTimeZone(''));
  ok('Dubai 09:15 local = 05:15 UTC', zonedToUtc(2026, 9, 15, 9 * 60 + 15, 'Asia/Dubai') === Date.UTC(2026, 8, 15, 5, 15));
  ok('negative minutes roll to previous day (23:55)', zonedToUtc(2026, 9, 16, -5, 'Asia/Dubai') === Date.UTC(2026, 8, 15, 19, 55));
  ok('New York summer (EDT, UTC-4)', zonedToUtc(2026, 7, 1, 9 * 60, 'America/New_York') === Date.UTC(2026, 6, 1, 13, 0));
  ok('New York winter (EST, UTC-5)', zonedToUtc(2026, 12, 1, 9 * 60, 'America/New_York') === Date.UTC(2026, 11, 1, 14, 0));
  ok('London after DST change', zonedToUtc(2026, 10, 26, 8 * 60, 'Europe/London') === Date.UTC(2026, 9, 26, 8, 0));
  const p = zonedParts(Date.UTC(2026, 8, 15, 20, 30), 'Asia/Dubai');
  ok('zonedParts across midnight', p.d === 16 && p.h === 0 && p.mi === 30, p);
}

/* ---------- 4. class firing window ---------- */
{
  const tz = 'Asia/Dubai';
  const rules = [{ day: 2, start_min: 9 * 60 + 30, tag: 'class-oop' }, { day: 3, start_min: 10, tag: 'class-midnight' }];
  const at = (y, mo, d, h, mi, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s);
  // Tue 15 Sep 2026: OOP 09:30 local -> alert 09:15 local = 05:15Z
  ok('not before 15-min mark', dueClassFirings(rules, tz, at(2026, 9, 15, 5, 14, 59)).length === 0);
  const f = dueClassFirings(rules, tz, at(2026, 9, 15, 5, 15));
  ok('fires exactly at 15-min mark', f.length === 1 && f[0].rule.tag === 'class-oop' && f[0].fireAt === at(2026, 9, 15, 5, 15));
  ok('still due 9 min late (retry window)', dueClassFirings(rules, tz, at(2026, 9, 15, 5, 24, 59)).length === 1);
  ok('dropped when >10 min late', dueClassFirings(rules, tz, at(2026, 9, 15, 5, 25, 1)).length === 0);
  ok('wrong weekday never fires', dueClassFirings(rules, tz, at(2026, 9, 17, 5, 15)).length === 0);
  // Wed 00:10 class -> alert Tue 23:55 local = Tue 19:55Z
  const m = dueClassFirings(rules, tz, at(2026, 9, 15, 19, 56));
  ok('class just after midnight alerts the evening before', m.length === 1 && m[0].rule.tag === 'class-midnight' && m[0].fireAt === at(2026, 9, 15, 19, 55));
}

/* ---------- 5. rule validation ---------- */
{
  const now = Date.now();
  ok('accepts class + once rules', validRules([
    { kind: 'class', day: 2, start: 570, title: 'OOP in 15 min', body: 'Lecture', tag: 'c1' },
    { kind: 'once', at: now + 3600e3, ttl: 7200, title: 'Midterm in 2 hours', body: '', tag: 'r1-2h' }], now).length === 2);
  ok('rejects bad weekday', validRules([{ kind: 'class', day: 7, start: 570, title: 't', body: '', tag: 'x' }], now) === null);
  ok('rejects missing title', validRules([{ kind: 'class', day: 1, start: 570, body: '', tag: 'x' }], now) === null);
  ok('rejects far-future once', validRules([{ kind: 'once', at: now + 500 * 24 * 3600e3, title: 't', body: '', tag: 'x' }], now) === null);
  ok('rejects unknown kind', validRules([{ kind: 'weird', title: 't', body: '', tag: 'x' }], now) === null);
  ok('rejects too many rules', validRules(Array.from({ length: LIMITS.MAX_RULES + 1 }, (_, i) => ({ kind: 'class', day: 1, start: 1, title: 't', body: '', tag: 'x' + i })), now) === null);
}

/* ---------- 6. full API + minute run against real SQLite (same engine as D1) ---------- */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { db.prepare(sql).run(...params); return { success: true }; },
    _exec: () => db.prepare(sql).run(...params)
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { list.forEach((s) => s._exec()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return list.map(() => ({ success: true }));
    }
  };
}

{
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const env = {
    DB: fakeD1(),
    ALLOWED_ORIGINS: 'https://moodigg.github.io,http://127.0.0.1:5190',
    VAPID_PUBLIC_KEY: b64urlEncode(Buffer.concat([Buffer.from([4]), Buffer.from(b64urlDecode(pubJwk.x)), Buffer.from(b64urlDecode(pubJwk.y))])),
    VAPID_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })),
    VAPID_SUBJECT: 'https://moodigg.github.io/uni-planner/'
  };
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(crypto.randomBytes(16)) } };
  const call = (method, path, body, origin = 'https://moodigg.github.io') =>
    worker.fetch(new Request('https://w.example' + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, origin ? { Origin: origin } : {}), body: body ? JSON.stringify(body) : undefined }), env);

  // origin lock
  let r = await call('POST', '/v1/subscribe', { subscription, tz: 'Asia/Dubai', rules: [] }, 'https://evil.example');
  ok('other websites are refused', r.status === 403);
  r = await call('POST', '/v1/subscribe', { subscription, tz: 'Asia/Dubai', rules: [] }, null);
  ok('requests without Origin are refused', r.status === 403);
  r = await call('OPTIONS', '/v1/subscribe', null);
  ok('CORS preflight allowed for the app', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://moodigg.github.io');
  // endpoint allow-list (no SSRF)
  r = await call('POST', '/v1/subscribe', { subscription: Object.assign({}, subscription, { endpoint: 'https://example.com/steal' }), tz: 'Asia/Dubai', rules: [] });
  ok('non-push-service endpoints rejected', r.status === 400);

  // subscribe with real-looking rules (Dubai, Tue OOP 09:30 + a deadline)
  // a Tuesday 09:15 Dubai (05:15Z) at least a week after the real clock, so it's after rule creation
  const WEEK = 7 * 24 * 3600e3;
  const tuesdayAfter = (ms) => { const d = new Date(ms + WEEK); d.setUTCHours(5, 15, 0, 0); while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); return d.getTime(); };
  const now = tuesdayAfter(Date.now());
  const rules = [
    { kind: 'class', day: 2, start: 570, title: 'Object Oriented Programming in 15 min', body: 'Lecture · C131S · 9:30am', tag: 'class-c1' },
    { kind: 'once', at: now - 60000, ttl: 7200, title: 'Midterm exam in 2 hours', body: 'INT301 · 11:15am', tag: 'rem-r1-2h' },
    { kind: 'once', at: now + 3600e3, ttl: 7200, title: 'Later thing', body: '', tag: 'rem-r2-2h' }
  ];
  // validRules checks `at` against real now, so shift the deadline test to real time
  const realNow = Date.now();
  rules[1].at = realNow + 20000; rules[2].at = realNow + 3600e3;
  r = await call('POST', '/v1/subscribe', { subscription, tz: 'Asia/Dubai', rules });
  const created = await r.json();
  ok('subscribe creates device + token', r.status === 201 && created.deviceId && created.token && created.rules === 3, created);
  const stored = env.DB.raw.prepare('SELECT * FROM devices').all();
  ok('token stored only as a hash', stored.length === 1 && stored[0].token_hash !== created.token && stored[0].token_hash.length === 64);

  // auth
  r = await call('PUT', '/v1/device', { deviceId: created.deviceId, token: 'wrong', tz: 'Asia/Dubai', rules });
  ok('wrong token refused', r.status === 401);

  // minute run: class (fake clock) + due deadline (real clock)
  const sent = [];
  const fakeSender = async (device, payload, opts) => { sent.push({ device: device.id, payload, ttl: opts.ttl }); return { ok: true, status: 201 }; };
  // deadline first, on the real clock (later steps jump a week ahead, which ages it out)
  let res = await runDue(env, realNow + 30000, fakeSender);
  ok('due deadline sent, future one not', res.sent === 1 && sent[0].payload.tag === 'rem-r1-2h', sent.map((s) => s.payload.tag));
  res = await runDue(env, realNow + 90000, fakeSender);
  ok('deadline not repeated', res.sent === 0);
  res = await runDue(env, now, fakeSender);
  ok('class alert sent at 09:15 Dubai', res.sent === 1 && sent[1].payload.tag === 'class-c1' && sent[1].ttl === 900, { res, sent });
  res = await runDue(env, now + 60000, fakeSender);
  ok('same class alert NOT sent twice next minute', res.sent === 0 && sent.length === 2, res);

  // transient failure retries, permanent 410 removes the device
  const tNow = now + WEEK;                              // next Tuesday, same class
  let calls = 0;
  res = await runDue(env, tNow, async () => { calls++; return { ok: false, status: 503 }; });
  ok('push service 503: not marked sent', res.sent === 0 && env.DB.raw.prepare("SELECT COUNT(*) n FROM sent WHERE fire_at = ?").get(tNow).n === 0);
  res = await runDue(env, tNow + 60000, fakeSender);
  ok('retried and delivered next minute', res.sent === 1);

  // update rules via PUT
  r = await call('PUT', '/v1/device', { deviceId: created.deviceId, token: created.token, tz: 'Asia/Dubai', rules: [rules[0]] });
  ok('sync replaces rules', r.status === 200 && env.DB.raw.prepare('SELECT COUNT(*) n FROM rules').get().n === 1);

  // batching cap
  const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'class', day: 2, start: 570, title: 'C' + i, body: '', tag: 'bulk-' + i }));
  await call('PUT', '/v1/device', { deviceId: created.deviceId, token: created.token, tz: 'Asia/Dubai', rules: many });
  const bNow = now + 2 * WEEK;
  let n = 0; const counter = async () => { n++; return { ok: true, status: 201 }; };
  res = await runDue(env, bNow, counter);
  ok('at most ' + LIMITS.SENDS_PER_RUN + ' sends per minute', res.sent === LIMITS.SENDS_PER_RUN && res.due === 20, res);
  res = await runDue(env, bNow + 60000, counter);
  res = await runDue(env, bNow + 120000, counter);
  ok('leftovers delivered over the next minutes, none twice', n === 20, n);

  // gone subscription is cleaned up
  res = await runDue(env, now + 3 * WEEK, async () => ({ ok: false, status: 410, gone: true }));
  ok('expired subscription (410) removes the device', env.DB.raw.prepare('SELECT COUNT(*) n FROM devices').get().n === 0 &&
    env.DB.raw.prepare('SELECT COUNT(*) n FROM rules').get().n === 0, res);

  // device cap
  env.DB.raw.exec('DELETE FROM devices');
  const ins = env.DB.raw.prepare("INSERT INTO devices (id, token_hash, endpoint, p256dh, auth, tz, created_at, updated_at) VALUES (?, 'h', ?, 'p', 'a', 'Asia/Dubai', 0, 0)");
  for (let i = 0; i < LIMITS.MAX_DEVICES; i++) ins.run('d' + i, 'https://fcm.googleapis.com/fcm/send/x' + i);
  r = await call('POST', '/v1/subscribe', { subscription, tz: 'Asia/Dubai', rules: [] });
  ok('new devices refused when full (' + LIMITS.MAX_DEVICES + ')', r.status === 503);

  // oversized body
  r = await call('POST', '/v1/subscribe', { subscription, tz: 'Asia/Dubai', rules: [], pad: 'x'.repeat(70000) });
  ok('oversized request refused', r.status === 400);
}

/* ---------- 7. no stale/duplicate alerts around (re)subscribing, honest late titles ---------- */
{
  ok('late retry says real minutes left', classTitle('Operating Systems in 15 min', 1000 * 60 * 30, 1000 * 60 * 21) === 'Operating Systems in 9 min');
  ok('on-time title unchanged', classTitle('Operating Systems in 15 min', 1000 * 60 * 30, 1000 * 60 * 15) === 'Operating Systems in 15 min');
  ok('title at class start', classTitle('OS in 15 min', 1000 * 60 * 30, 1000 * 60 * 30) === 'OS is starting now');

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const env = {
    DB: fakeD1(), ALLOWED_ORIGINS: 'https://moodigg.github.io',
    VAPID_PUBLIC_KEY: b64urlEncode(Buffer.concat([Buffer.from([4]), Buffer.from(b64urlDecode(pubJwk.x)), Buffer.from(b64urlDecode(pubJwk.y))])),
    VAPID_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })), VAPID_SUBJECT: 'https://moodigg.github.io/uni-planner/'
  };
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/second', keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(crypto.randomBytes(16)) } };
  const call = (method, path, body) => worker.fetch(new Request('https://w.example' + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'https://moodigg.github.io' }, body: JSON.stringify(body) }), env);
  const sent = []; const sender = async (d, payload) => { sent.push(payload); return { ok: true, status: 201 }; };

  // a class whose 15-min alert was 3 minutes ago (real clock), in the device's own zone (UTC here)
  const real = Date.now();
  const startLocal = new Date(real + 12 * 60000);                  // class starts in 12 min -> alert was 3 min ago
  const cls = { kind: 'class', day: startLocal.getUTCDay(), start: startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes(), title: 'Fresh Class in 15 min', body: 'Lecture', tag: 'class-fresh' };
  let r = await call('POST', '/v1/subscribe', { subscription, tz: 'UTC', rules: [cls] });
  const dev = await r.json();
  let res = await runDue(env, real, sender);
  ok('turning notifications on does NOT send an alert whose time already passed', res.sent === 0 && sent.length === 0, res);

  // off/on seconds after an alert went out: the new device must not get it again
  env.DB.raw.exec('DELETE FROM rules; DELETE FROM sent; DELETE FROM devices;');
  const justNow = new Date(Math.floor(Date.now() / 60000) * 60000 + 15 * 60000);   // alert fired at the start of this minute (<60s ago)
  const cls3 = { kind: 'class', day: justNow.getUTCDay(), start: justNow.getUTCHours() * 60 + justNow.getUTCMinutes(), title: 'Resub in 15 min', body: '', tag: 'class-resub' };
  const ua3 = crypto.createECDH('prime256v1'); ua3.generateKeys();
  const sub3 = { endpoint: 'https://fcm.googleapis.com/fcm/send/third', keys: { p256dh: b64urlEncode(ua3.getPublicKey()), auth: b64urlEncode(crypto.randomBytes(16)) } };
  r = await call('POST', '/v1/subscribe', { subscription: sub3, tz: 'UTC', rules: [cls3] });
  const before3 = sent.length;
  res = await runDue(env, Date.now() + 1000, sender);
  ok('re-enabling seconds after an alert does NOT resend it', res.sent === 0 && sent.length === before3, res);
  const dev3 = await r.json();

  // an existing rule stays deliverable when a sync lands between its alert time and the next tick
  const soon = new Date(real + 16 * 60000);                         // alert in ~1 min
  const cls2 = { kind: 'class', day: soon.getUTCDay(), start: soon.getUTCHours() * 60 + soon.getUTCMinutes(), title: 'Kept Class in 15 min', body: 'Lecture', tag: 'class-kept' };
  r = await call('PUT', '/v1/device', { deviceId: dev3.deviceId, token: dev3.token, tz: 'UTC', rules: [cls, cls2] });
  env.DB.raw.prepare("UPDATE rules SET created_at = created_at - 600000 WHERE tag = 'class-kept'").run();   // pretend it existed 10 min ago
  const keptCreated = env.DB.raw.prepare("SELECT created_at FROM rules WHERE tag = 'class-kept'").get().created_at;
  r = await call('PUT', '/v1/device', { deviceId: dev3.deviceId, token: dev3.token, tz: 'UTC', rules: [cls, cls2, { kind: 'once', at: real + 3600e3, title: 'Other', body: '', tag: 'other' }] });
  ok('unchanged alert keeps its original created time across syncs', env.DB.raw.prepare("SELECT created_at FROM rules WHERE tag = 'class-kept'").get().created_at === keptCreated);
  const fireKept = Math.floor((real + 16 * 60000) / 60000) * 60000 - 15 * 60000;
  res = await runDue(env, fireKept + 30000, sender);
  ok('alert due during a sync is still delivered', sent.some((p) => p.tag === 'class-kept'), sent.map((p) => p.tag));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
