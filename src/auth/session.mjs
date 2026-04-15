// HMAC-SHA256 signed session tokens.
// Token format: base64url(payloadJson) "." base64url(hmac).
// Server stores sha256(token) in staff_members.session_token_hash for fast lookup.

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const SESSION_TTL_SEC = 12 * 60 * 60; // 12 hours

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(signingKey) {
  return crypto.subtle.importKey('raw', ENC.encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', ENC.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionToken(env, { staffId, email, role }) {
  if (!env.SESSION_SIGNING_KEY) throw new Error('SESSION_SIGNING_KEY not set');
  const payload = {
    sid: staffId,
    em: email,
    r: role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = b64url(ENC.encode(payloadStr));
  const key = await importKey(env.SESSION_SIGNING_KEY);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payloadB64));
  const token = `${payloadB64}.${b64url(sig)}`;
  const tokenHash = await sha256Hex(token);
  return {
    token,
    tokenHash,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    payload,
  };
}

export async function verifySessionToken(env, token) {
  if (!env.SESSION_SIGNING_KEY) return null;
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await importKey(env.SESSION_SIGNING_KEY);
    const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), ENC.encode(payloadB64));
    if (!valid) return null;
    const payload = JSON.parse(DEC.decode(b64urlDecode(payloadB64)));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function cookieSerialize(name, value, { maxAge, path = '/', secure = true, httpOnly = true, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${value}`];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  parts.push(`Path=${path}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

export { SESSION_TTL_SEC, sha256Hex };
