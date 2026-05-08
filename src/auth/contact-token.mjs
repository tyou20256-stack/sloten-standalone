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

// HMAC key import — shared with session.mjs via lib/crypto.mjs.
import { importHmacKey } from '../lib/crypto.mjs';
async function importKey(secret) {
  return importHmacKey(secret, ['sign', 'verify']);
}

/** Prefer dedicated CONTACT_TOKEN_SIGNING_KEY, fallback to shared SESSION_SIGNING_KEY. */
function resolveContactKey(env) {
  return env.CONTACT_TOKEN_SIGNING_KEY || env.SESSION_SIGNING_KEY;
}

export async function issueContactToken(env, contactId) {
  const signingKey = resolveContactKey(env);
  if (!signingKey) throw new Error('CONTACT_TOKEN_SIGNING_KEY / SESSION_SIGNING_KEY not set');
  const payload = {
    cid: contactId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TTL_SEC,
  };
  const payloadB64 = b64url(ENC.encode(JSON.stringify(payload)));
  const key = await importKey(signingKey);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
}

export async function verifyContactToken(env, token) {
  const newKey = env.CONTACT_TOKEN_SIGNING_KEY;
  const oldKey = env.SESSION_SIGNING_KEY;
  if (!newKey && !oldKey) return null;
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    // Try dedicated key first
    if (newKey) {
      const key = await importKey(newKey);
      if (await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), ENC.encode(parts[0]))) {
        const payload = JSON.parse(DEC.decode(b64urlDecode(parts[0])));
        if (!payload?.cid || !payload?.exp) return null;
        if (payload.exp * 1000 < Date.now()) return null;
        return payload;
      }
    }
    // Dual-verify: fallback to legacy shared key
    if (oldKey && oldKey !== newKey) {
      const key = await importKey(oldKey);
      if (await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), ENC.encode(parts[0]))) {
        console.log('[contact-token] verified with legacy SESSION_SIGNING_KEY — rotate pending');
        const payload = JSON.parse(DEC.decode(b64urlDecode(parts[0])));
        if (!payload?.cid || !payload?.exp) return null;
        if (payload.exp * 1000 < Date.now()) return null;
        return payload;
      }
    }
    return null;
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
