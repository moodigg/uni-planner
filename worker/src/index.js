/* ============================================================
   Uni Planner push worker
   - fetch:     tiny JSON API the app uses to turn notifications on/off and sync what to notify
   - scheduled: every minute, sends whatever is due (and never the same one twice)
   ============================================================ */
import { sendPush, b64urlDecode, b64urlEncode } from './webpush.js';
import { isValidTimeZone, zonedParts, zonedToUtc } from './tz.js';

export const LIMITS = {
  MAX_DEVICES: 40,           // uni group chat is ~15; leaves headroom, stops the DB being filled
  MAX_RULES: 400,
  MAX_BODY_BYTES: 64 * 1024,
  WINDOW_MS: 10 * 60 * 1000, // anything more than 10 min late is dropped, not sent
  SENDS_PER_RUN: 8,          // keeps each minute's run small; leftovers go out next minute
  CLASS_LEAD_MIN: 15,
  TEST_COOLDOWN_MS: 30 * 1000
};

// only real browser push services — never let the worker be pointed at arbitrary URLs
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error('fetch error', err && err.stack || err);
      return json({ error: 'server_error' }, 500, request, env);
    }
  },
  async scheduled(event, env, ctx) {
    // With the Durable Object ticker bound, it does the sending; cron is only a watchdog that re-arms it.
    if (env.TICKER) {
      ctx.waitUntil(ensureTicker(env).catch((e) => console.error('ensure ticker failed', e && e.message)));
      return;
    }
    const started = Date.now();
    ctx.waitUntil((async () => {
      let status;
      try {
        const r = await runDue(env, started);
        status = Object.assign({ at: started, ok: true }, r);
      } catch (err) {
        status = { at: started, ok: false, error: String(err && err.message || err).slice(0, 300) };
        console.error('run failed', err && err.stack || err);
      }
      console.log('run', JSON.stringify(status));
      try {
        await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .bind('last_run', JSON.stringify(status)).run();
      } catch (e) { /* meta is best-effort */ }
    })());
  }
};

export async function ensureTicker(env) {
  if (!env.TICKER) return null;
  const stub = env.TICKER.get(env.TICKER.idFromName('main'));
  return stub.ensure();
}

/* ---------------- HTTP ---------------- */

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function json(data, status, request, env) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  const origin = request && allowedOrigin(request, env);
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(data === null ? null : JSON.stringify(data), { status, headers });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);

  if (request.method === 'OPTIONS') return json(null, origin ? 204 : 403, request, env);
  if (url.pathname === '/health' && request.method === 'GET') {
    let lastRun = null;
    try {
      const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_run'").first();
      if (row) {
        const r = JSON.parse(row.value);
        lastRun = { at: new Date(r.at).toISOString(), ok: r.ok, secondsAgo: Math.round((Date.now() - r.at) / 1000), error: r.error || undefined };
      }
    } catch (e) { /* table may not exist yet */ }
    let ticker = null;
    try { ticker = await ensureTicker(env); } catch (e) { ticker = { error: String(e && e.message || e).slice(0, 120) }; }
    return json({ ok: true, vapidPublicKey: env.VAPID_PUBLIC_KEY, lastRun, ticker }, 200, request, env);
  }
  // browsers always send Origin on cross-site POST/PUT/DELETE; anything else isn't our app
  if (!origin) return json({ error: 'origin_not_allowed' }, 403, request, env);

  const body = await readJson(request);
  if (body === undefined) return json({ error: 'bad_json' }, 400, request, env);

  if (url.pathname === '/v1/subscribe' && request.method === 'POST') return subscribe(body, env, request);
  if (url.pathname === '/v1/device' && request.method === 'PUT') return updateDevice(body, env, request);
  if (url.pathname === '/v1/device' && request.method === 'DELETE') return deleteDevice(body, env, request);
  if (url.pathname === '/v1/test' && request.method === 'POST') return testPush(body, env, request);
  return json({ error: 'not_found' }, 404, request, env);
}

async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > LIMITS.MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (text.length > LIMITS.MAX_BODY_BYTES) return undefined;
  try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' ? v : undefined; } catch (e) { return undefined; }
}

/* ---------------- validation ---------------- */

function validSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024) return null;
  let u;
  try { u = new URL(sub.endpoint); } catch (e) { return null; }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  const keys = sub.keys || {};
  try {
    if (b64urlDecode(keys.p256dh).length !== 65 || b64urlDecode(keys.auth).length !== 16) return null;
  } catch (e) { return null; }
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function validRules(rules, now) {
  if (!Array.isArray(rules) || rules.length > LIMITS.MAX_RULES) return null;
  const out = [];
  for (const r of rules) {
    if (!r || typeof r !== 'object' || !str(r.title, 120) || !(typeof r.body === 'string' && r.body.length <= 240) || !str(r.tag, 100)) return null;
    if (r.kind === 'class') {
      if (!Number.isInteger(r.day) || r.day < 0 || r.day > 6 || !Number.isInteger(r.start) || r.start < 0 || r.start > 1439) return null;
      out.push({ kind: 'class', day: r.day, start_min: r.start, at: null, title: r.title, body: r.body, tag: r.tag, ttl: LIMITS.CLASS_LEAD_MIN * 60 });
    } else if (r.kind === 'once') {
      if (!Number.isInteger(r.at) || r.at < now - 24 * 3600e3 || r.at > now + 400 * 24 * 3600e3) return null;
      const ttl = Number.isInteger(r.ttl) ? Math.min(Math.max(r.ttl, 60), 12 * 3600) : 3600;
      out.push({ kind: 'once', day: null, start_min: null, at: r.at, title: r.title, body: r.body, tag: r.tag, ttl });
    } else {
      return null;
    }
  }
  return out;
}

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes) { return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes))); }

async function authDevice(body, env) {
  if (!str(body.deviceId, 64) || !str(body.token, 128)) return null;
  const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(body.deviceId).first();
  if (!row) return null;
  const hash = await sha256Hex(body.token);
  return timingSafeEqual(hash, row.token_hash) ? row : null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/* Rules are replaced wholesale on every sync. `created_at` marks when each alert first appeared;
   unchanged alerts (same tag) keep their original time so an edit made in the same minute an alert
   is due can't cancel it, while brand-new ones never fire for a moment that has already passed. */
function ruleStatements(env, deviceId, rules, now, previous = new Map()) {
  const stmts = [env.DB.prepare('DELETE FROM rules WHERE device_id = ?').bind(deviceId)];
  // D1 allows at most 100 bound parameters per statement: 10 columns x 10 rows
  for (let i = 0; i < rules.length; i += 10) {
    const chunk = rules.slice(i, i + 10);
    const sql = 'INSERT INTO rules (device_id, kind, day, start_min, at, title, body, tag, ttl, created_at) VALUES ' +
      chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    chunk.forEach((r) => params.push(deviceId, r.kind, r.day, r.start_min, r.at, r.title, r.body, r.tag, r.ttl,
      previous.has(r.tag) ? previous.get(r.tag) : now));
    stmts.push(env.DB.prepare(sql).bind(...params));
  }
  return stmts;
}

/* ---------------- endpoints ---------------- */

async function subscribe(body, env, request) {
  const now = Date.now();
  const sub = validSubscription(body.subscription);
  if (!sub) return json({ error: 'bad_subscription' }, 400, request, env);
  if (!isValidTimeZone(body.tz)) return json({ error: 'bad_tz' }, 400, request, env);
  const rules = validRules(body.rules || [], now);
  if (!rules) return json({ error: 'bad_rules' }, 400, request, env);

  const existing = await env.DB.prepare('SELECT id FROM devices WHERE endpoint = ?').bind(sub.endpoint).first();
  if (!existing) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first();
    if (n >= LIMITS.MAX_DEVICES) return json({ error: 'full' }, 503, request, env);
  }
  const id = randomToken(18);
  const token = randomToken(32);
  const stmts = [];
  if (existing) {   // same browser subscribing again: replace its old record
    stmts.push(env.DB.prepare('DELETE FROM rules WHERE device_id = ?').bind(existing.id));
    stmts.push(env.DB.prepare('DELETE FROM sent WHERE device_id = ?').bind(existing.id));
    stmts.push(env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(existing.id));
  }
  stmts.push(env.DB.prepare('INSERT INTO devices (id, token_hash, endpoint, p256dh, auth, tz, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, await sha256Hex(token), sub.endpoint, sub.p256dh, sub.auth, body.tz, now, now));
  stmts.push(...ruleStatements(env, id, rules, now).slice(1));
  await env.DB.batch(stmts);
  await ensureTicker(env).catch((e) => console.error('ensure ticker failed', e && e.message));
  return json({ deviceId: id, token, rules: rules.length }, 201, request, env);
}

async function updateDevice(body, env, request) {
  const device = await authDevice(body, env);
  if (!device) return json({ error: 'unknown_device' }, 401, request, env);
  const now = Date.now();
  if (!isValidTimeZone(body.tz)) return json({ error: 'bad_tz' }, 400, request, env);
  const rules = validRules(body.rules || [], now);
  if (!rules) return json({ error: 'bad_rules' }, 400, request, env);
  let sub = null;
  if (body.subscription) {
    sub = validSubscription(body.subscription);
    if (!sub) return json({ error: 'bad_subscription' }, 400, request, env);
  }
  const stmts = [env.DB.prepare('UPDATE devices SET tz = ?, updated_at = ?, endpoint = ?, p256dh = ?, auth = ? WHERE id = ?')
    .bind(body.tz, now, sub ? sub.endpoint : device.endpoint, sub ? sub.p256dh : device.p256dh, sub ? sub.auth : device.auth, device.id)];
  const prev = (await env.DB.prepare('SELECT tag, created_at FROM rules WHERE device_id = ?').bind(device.id).all()).results;
  stmts.push(...ruleStatements(env, device.id, rules, now, new Map(prev.map((p) => [p.tag, p.created_at]))));
  await env.DB.batch(stmts);
  await ensureTicker(env).catch((e) => console.error('ensure ticker failed', e && e.message));
  return json({ ok: true, rules: rules.length }, 200, request, env);
}

async function deleteDevice(body, env, request) {
  const device = await authDevice(body, env);
  if (!device) return json({ ok: true }, 200, request, env);   // already gone: fine
  await removeDevice(env, device.id);
  return json({ ok: true }, 200, request, env);
}

async function removeDevice(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rules WHERE device_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sent WHERE device_id = ?').bind(id),
    env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id)
  ]);
}

function pushOpts(env) {
  return { vapidPublic: env.VAPID_PUBLIC_KEY, vapidPrivateJwk: env.VAPID_PRIVATE_JWK, subject: env.VAPID_SUBJECT };
}

async function testPush(body, env, request) {
  const device = await authDevice(body, env);
  if (!device) return json({ error: 'unknown_device' }, 401, request, env);
  const now = Date.now();
  if (now - device.last_test_at < LIMITS.TEST_COOLDOWN_MS) return json({ error: 'slow_down' }, 429, request, env);
  await env.DB.prepare('UPDATE devices SET last_test_at = ? WHERE id = ?').bind(now, device.id).run();
  const r = await sendPush(device, {
    title: 'Notifications are on',
    body: "You'll get class alerts 15 min before, and deadline reminders.",
    tag: 'uniplanner-test'
  }, Object.assign({ ttl: 300 }, pushOpts(env)));
  if (r.gone) await removeDevice(env, device.id);
  return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502, request, env);
}

/* ---------------- the every-minute run ---------------- */

export function dueClassFirings(rules, tz, now, windowMs = LIMITS.WINDOW_MS, leadMin = LIMITS.CLASS_LEAD_MIN) {
  const local = zonedParts(now, tz);
  const out = [];
  for (let off = -1; off <= 1; off++) {
    const base = new Date(Date.UTC(local.y, local.m - 1, local.d + off));
    const weekday = base.getUTCDay();
    for (const r of rules) {
      if (r.day !== weekday) continue;
      const fireAt = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), r.start_min - leadMin, tz);
      if (fireAt <= now && fireAt > now - windowMs) out.push({ rule: r, fireAt, classStart: fireAt + leadMin * 60000 });
    }
  }
  return out;
}

/* "Operating Systems in 15 min" -> "in 9 min" if a retry delivers it late */
export function classTitle(title, classStart, now) {
  const left = Math.max(0, Math.round((classStart - now) / 60000));
  if (left >= LIMITS.CLASS_LEAD_MIN) return title;
  const m = String(title).match(/^(.*) in \d+ min$/);
  if (!m) return title;
  return left <= 0 ? m[1] + ' is starting now' : m[1] + ' in ' + left + ' min';
}

export async function runDue(env, now, sender = sendPush) {
  const devices = (await env.DB.prepare('SELECT * FROM devices').all()).results;
  if (!devices.length) return { devices: 0, due: 0, sent: 0 };
  const byId = new Map(devices.map((d) => [d.id, d]));

  const candidates = [];
  const classRules = (await env.DB.prepare("SELECT * FROM rules WHERE kind = 'class'").all()).results;
  const classByDevice = new Map();
  for (const r of classRules) {
    if (!classByDevice.has(r.device_id)) classByDevice.set(r.device_id, []);
    classByDevice.get(r.device_id).push(r);
  }
  for (const [deviceId, rules] of classByDevice) {
    const d = byId.get(deviceId);
    if (!d) continue;
    for (const f of dueClassFirings(rules, d.tz, now)) {
      if (f.fireAt < (f.rule.created_at || 0)) continue;   // alert time passed before this rule existed (both are server-clock times)
      candidates.push({ device: d, tag: f.rule.tag, fireAt: f.fireAt, title: classTitle(f.rule.title, f.classStart, now), body: f.rule.body,
        ttl: Math.max(60, Math.floor((f.classStart - now) / 1000)) });
    }
  }
  const onceRules = (await env.DB.prepare("SELECT * FROM rules WHERE kind = 'once' AND at <= ? AND at > ?")
    .bind(now, now - LIMITS.WINDOW_MS).all()).results;
  for (const r of onceRules) {
    const d = byId.get(r.device_id);
    if (d && r.at >= (r.created_at || 0)) candidates.push({ device: d, tag: r.tag, fireAt: r.at, title: r.title, body: r.body, ttl: r.ttl });
  }

  const sentRows = (await env.DB.prepare('SELECT device_id, tag, fire_at FROM sent WHERE fire_at > ?')
    .bind(now - LIMITS.WINDOW_MS - 60000).all()).results;
  const already = new Set(sentRows.map((s) => s.device_id + '|' + s.tag + '|' + s.fire_at));
  const pending = candidates.filter((c) => !already.has(c.device.id + '|' + c.tag + '|' + c.fireAt))
    .sort((a, b) => a.fireAt - b.fireAt);
  const batch = pending.slice(0, LIMITS.SENDS_PER_RUN);

  let sent = 0;
  const gone = new Set();
  const results = await Promise.all(batch.map(async (c) => {
    try {
      const r = await sender(c.device, { title: c.title, body: c.body, tag: c.tag }, Object.assign({ ttl: c.ttl }, pushOpts(env)));
      return { c, r };
    } catch (err) {
      console.error('send error', err && err.message);
      return { c, r: { ok: false, status: 0 } };
    }
  }));
  const writes = [];
  for (const { c, r } of results) {
    if (r.ok) {
      sent++;
      writes.push(env.DB.prepare('INSERT OR IGNORE INTO sent (device_id, tag, fire_at, sent_at) VALUES (?, ?, ?, ?)').bind(c.device.id, c.tag, c.fireAt, now));
      if (c.device.fail_count) writes.push(env.DB.prepare('UPDATE devices SET fail_count = 0 WHERE id = ?').bind(c.device.id));
    } else if (r.gone) {
      gone.add(c.device.id);
    } else if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      // permanent rejection of this message: don't retry it every minute
      writes.push(env.DB.prepare('INSERT OR IGNORE INTO sent (device_id, tag, fire_at, sent_at) VALUES (?, ?, ?, ?)').bind(c.device.id, c.tag, c.fireAt, now));
      writes.push(env.DB.prepare('UPDATE devices SET fail_count = fail_count + 1 WHERE id = ?').bind(c.device.id));
    }
    // 429 / 5xx / network: leave it; next minute retries while still inside the window
  }
  // housekeeping
  writes.push(env.DB.prepare('DELETE FROM sent WHERE sent_at < ?').bind(now - 2 * 24 * 3600e3));
  writes.push(env.DB.prepare("DELETE FROM rules WHERE kind = 'once' AND at < ?").bind(now - 24 * 3600e3));
  await env.DB.batch(writes);
  for (const id of gone) await removeDevice(env, id);
  return { devices: devices.length, due: pending.length, sent, removed: gone.size };
}
