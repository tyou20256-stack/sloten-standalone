// Widget contact ownership token. HMAC-signed, 30-day TTL. Proves that the
// caller owns a specific contact_id without requiring a full staff session.
//
// Wire format: b64url(payloadJson) "." b64url(hmac)
// Payload: { cid: string, iat: number, exp: number }

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const TTL_SEC = 30 * 24 * 60 * 60;

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

async function importKey(secret) {
  return crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function issueContactToken(env, contactId) {
  if (!env.SESSION_SIGNING_KEY) throw new Error('SESSION_SIGNING_KEY not set');
  const payload = {
    cid: contactId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TTL_SEC,
  };
  const payloadB64 = b64url(ENC.encode(JSON.stringify(payload)));
  const key = await importKey(env.SESSION_SIGNING_KEY);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
}

export async function verifyContactToken(env, token) {
  if (!env.SESSION_SIGNING_KEY || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const key = await importKey(env.SESSION_SIGNING_KEY);
    const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), ENC.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(DEC.decode(b64urlDecode(parts[0])));
    if (!payload?.cid || !payload?.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Widget can send the token via header (preferred) or query string (for WS).
export function extractContactToken(request) {
  const h = request.headers.get('X-Sloten-Contact-Token');
  if (h) return h;
  try {
    const url = new URL(request.url);
    return url.searchParams.get('contact_token') || null;
  } catch {
    return null;
  }
}
