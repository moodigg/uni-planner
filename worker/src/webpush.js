/* Web Push sender using only WebCrypto.
   - Payload encryption: RFC 8291 (Message Encryption for Web Push), aes128gcm (RFC 8188)
   - Sender identity:    RFC 8292 (VAPID), ES256 JWT                                    */

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : s.length % 4 === 0 ? '' : null;
  if (pad === null) throw new Error('bad base64url');
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/* RFC 8291 §3.4 + RFC 8188: returns the full request body (header + one encrypted record). */
export async function encryptPayload(plaintext, p256dhB64, authB64, opts = {}) {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh');
  if (authSecret.length !== 16) throw new Error('bad auth');

  const asKeys = opts.asKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info" 0x00 ua_public as_public, L=32)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));

  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);

  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const record = concat(data, new Uint8Array([2]));             // 0x02 = last (and only) record, no padding
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, record));

  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]),
    new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/* RFC 8292 VAPID JWT, cached per push-service origin for ~12h. */
const jwtCache = new Map();
let signingKey = null, signingKeySource = null;

async function getSigningKey(privateJwkJson) {
  if (signingKey && signingKeySource === privateJwkJson) return signingKey;
  const jwk = JSON.parse(privateJwkJson);
  signingKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  signingKeySource = privateJwkJson;
  return signingKey;
}

export async function vapidJwt(audience, subject, privateJwkJson, nowMs = Date.now()) {
  const cached = jwtCache.get(audience);
  if (cached && cached.exp * 1000 - nowMs > 60 * 60 * 1000) return cached.token;
  const exp = Math.floor(nowMs / 1000) + 12 * 60 * 60;                 // must be <= 24h
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const unsigned = header + '.' + claims;
  const key = await getSigningKey(privateJwkJson);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  const token = unsigned + '.' + b64urlEncode(sig);                    // WebCrypto gives raw r||s, as JWT needs
  jwtCache.set(audience, { token, exp });
  return token;
}

/* Send one notification. Returns { status, ok, gone } — gone = subscription no longer valid. */
export async function sendPush({ endpoint, p256dh, auth }, payloadObj, { ttl = 900, urgency = 'high', vapidPublic, vapidPrivateJwk, subject }) {
  const body = await encryptPayload(JSON.stringify(payloadObj), p256dh, auth);
  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(audience, subject, vapidPrivateJwk);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': String(Math.max(0, Math.floor(ttl))),
      'Urgency': urgency,
      'Authorization': 'vapid t=' + jwt + ', k=' + vapidPublic
    },
    body
  });
  return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
}
