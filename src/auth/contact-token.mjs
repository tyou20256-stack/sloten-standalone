// Widget contact ownership token. HMAC-signed, 7-day TTL. Proves that the
// caller owns a specific contact_id without requiring a full staff session.
//
// Wire format: b64url(payloadJson) "." b64url(hmac)
// Payload: { cid: string, jti: string, iat: number, exp: number }
//
// Revocation:
//   The token includes a `jti` (random 16-byte id). On GDPR erase or explicit
//   widget logout, we write `contact-revoked:<jti>` to KV with TTL ≥ remaining
//   token life. verifyContactToken consults this on every call. KV miss = OK
//   to use; KV hit = reject. Fail-open on KV transient errors (revocation is a
//   security improvement, not a hard gate; logged for monitoring).
//
// TTL was reduced 30d → 7d as part of 2026-05-09 audit (Security #2).
// Browsers retain widget tokens via localStorage; shared-device leakage is
// the main threat vector. 7d window minimizes blast radius while preserving
// "open chat → reload tomorrow → still logged in" UX.

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const TTL_SEC = 7 * 24 * 60 * 60;
const REVOKE_KEY_PREFIX = 'contact-revoked:';

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

/** 16 random bytes as hex — token-unique id for revocation lookups. */
function randomJti() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function issueContactToken(env, contactId) {
  const signingKey = resolveContactKey(env);
  if (!signingKey) throw new Error('CONTACT_TOKEN_SIGNING_KEY / SESSION_SIGNING_KEY not set');
  const payload = {
    cid: contactId,
    jti: randomJti(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TTL_SEC,
  };
  const payloadB64 = b64url(ENC.encode(JSON.stringify(payload)));
  const key = await importKey(signingKey);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
}

// Per-isolate negative-result cache for revocation lookups.
// Revocations are rare (GDPR erase / explicit logout); 99%+ of calls are
// "not revoked". KV.get costs 30-50ms p50 — by caching the negative answer
// per-isolate for a short window, we cut that cost on hot paths.
//
// Cache holds the lookup key → expiry timestamp (ms). On any positive result
// we DO NOT cache (security-conservative — re-check every time so a
// recently-revoked token doesn't slip through).
//
// TTL is intentionally short (5s). Cloudflare Workers route requests across
// isolates non-deterministically — same-isolate revocation invalidation only
// helps when the same isolate is hit again. 5s is enough to amortize KV cost
// for high-traffic widgets (chat-bursty users) while keeping cross-isolate
// revocation propagation lag acceptable for security purposes.
const REVOKE_NEGATIVE_CACHE = new Map();
const REVOKE_NEGATIVE_CACHE_MAX = 1024;
const REVOKE_NEGATIVE_TTL_MS = 5_000;

function cacheRevokedNegative(key) {
  if (REVOKE_NEGATIVE_CACHE.size >= REVOKE_NEGATIVE_CACHE_MAX) {
    const oldest = REVOKE_NEGATIVE_CACHE.keys().next().value;
    REVOKE_NEGATIVE_CACHE.delete(oldest);
  }
  REVOKE_NEGATIVE_CACHE.set(key, Date.now() + REVOKE_NEGATIVE_TTL_MS);
}

function isCachedNegative(key) {
  const exp = REVOKE_NEGATIVE_CACHE.get(key);
  if (!exp) return false;
  if (exp < Date.now()) {
    REVOKE_NEGATIVE_CACHE.delete(key);
    return false;
  }
  return true;
}

async function isRevoked(env, jti) {
  if (!jti) return false;
  const cacheKey = REVOKE_KEY_PREFIX + jti;
  // Fast path: recently confirmed not-revoked.
  if (isCachedNegative(cacheKey)) return false;
  const kv = env.SESSION_KV || env.RATE_LIMITER;
  if (!kv) return false;
  try {
    const flag = await kv.get(cacheKey);
    if (flag) return true;          // hit → don't cache (rare, must re-check)
    cacheRevokedNegative(cacheKey); // miss → safe to cache for 60s
    return false;
  } catch (e) {
    // Fail-open on KV transient errors. Revocation is a security improvement;
    // hard-failing on every KV outage would break all widget traffic.
    console.warn('[contact-token] revoke check failed (fail-open):', e?.message);
    return false;
  }
}

export async function verifyContactToken(env, token) {
  const newKey = env.CONTACT_TOKEN_SIGNING_KEY;
  const oldKey = env.SESSION_SIGNING_KEY;
  if (!newKey && !oldKey) return null;
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    let payload = null;
    // Try dedicated key first
    if (newKey) {
      const key = await importKey(newKey);
      if (await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), ENC.encode(parts[0]))) {
        payload = JSON.parse(DEC.decode(b64urlDecode(parts[0])));
      }
    }
    // Dual-verify: fallback to legacy shared key
    if (!payload && oldKey && oldKey !== newKey) {
      const key = await importKey(oldKey);
      if (await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), ENC.encode(parts[0]))) {
        console.log('[contact-token] verified with legacy SESSION_SIGNING_KEY — rotate pending');
        payload = JSON.parse(DEC.decode(b64urlDecode(parts[0])));
      }
    }
    if (!payload) return null;
    if (!payload.cid || !payload.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    // Revocation check: parallel KV reads to avoid sequential 30-50ms × 2
    // latency on every widget API call. jti may be absent on tokens issued
    // before 2026-05-09 (legacy 30d) — cid revocation set by GDPR erase
    // covers those. Both lookups are independent so Promise.all is safe.
    const [revokedByJti, revokedByCid] = await Promise.all([
      isRevoked(env, payload.jti),
      isRevoked(env, 'cid:' + payload.cid),
    ]);
    if (revokedByJti || revokedByCid) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Revoke a contact token by its jti. TTL set to remaining token lifetime
 * (or 7d max). KV write is non-blocking from the caller's perspective.
 *
 * Use cases:
 *   - GDPR erase: revoke all tokens for a contact_id
 *   - Explicit /api/widget/contacts/logout
 *
 * Same-isolate immediate effect: the per-isolate negative cache for this
 * key is dropped, so a follow-up verify in the same isolate sees the
 * revocation immediately. Cross-isolate propagation still depends on
 * KV consistency (typically &lt;1s).
 */
export async function revokeContactJti(env, jti, ttlSec = TTL_SEC) {
  const kv = env.SESSION_KV || env.RATE_LIMITER;
  if (!kv || !jti) return false;
  const cacheKey = REVOKE_KEY_PREFIX + jti;
  REVOKE_NEGATIVE_CACHE.delete(cacheKey);
  try {
    await kv.put(cacheKey, '1', { expirationTtl: Math.max(60, Math.min(ttlSec, TTL_SEC)) });
    return true;
  } catch (e) {
    console.warn('[contact-token] revoke write failed:', e?.message);
    return false;
  }
}

/**
 * Revoke ALL outstanding tokens for a contact_id (used by GDPR erase
 * since legacy tokens have no jti). 7d TTL covers max token life.
 *
 * Same-isolate immediate effect: drops the cid-keyed negative cache entry.
 */
export async function revokeAllContactTokens(env, contactId) {
  const kv = env.SESSION_KV || env.RATE_LIMITER;
  if (!kv || !contactId) return false;
  const cacheKey = REVOKE_KEY_PREFIX + 'cid:' + contactId;
  REVOKE_NEGATIVE_CACHE.delete(cacheKey);
  try {
    await kv.put(cacheKey, '1', { expirationTtl: TTL_SEC });
    return true;
  } catch (e) {
    console.warn('[contact-token] cid-revoke write failed:', e?.message);
    return false;
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
