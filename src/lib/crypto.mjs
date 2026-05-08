// Shared cryptographic primitives.
//
// Three HMAC-SHA256 output formats are exposed to cover the existing call
// sites without breaking token formats:
//
//   - hmacSignRaw      → ArrayBuffer (used by session.mjs / contact-token
//                        which b64url-encode themselves for JWT-like tokens)
//   - hmacSignHex      → 64-char lowercase hex (used by announcements.mjs
//                        for KV cache integrity)
//   - hmacVerifyHex    → constant-time hex compare
//
// The raw variant lets session.mjs share key-import while preserving its
// b64url(sig) wrapping. Earlier this module only had the hex variants, so
// session.mjs had its own duplicated importKey + sign; that's now consolidated.

const ENC = new TextEncoder();

export async function importHmacKey(secret, usages = ['sign']) {
  return crypto.subtle.importKey(
    'raw',
    ENC.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

/** HMAC-SHA256 sign returning the raw ArrayBuffer signature. */
export async function hmacSignRaw(secret, message) {
  if (!secret) throw new Error('hmacSignRaw: secret required');
  const key = await importHmacKey(secret);
  return crypto.subtle.sign('HMAC', key, ENC.encode(message));
}

/**
 * HMAC-SHA256 sign — returns hex (64 chars).
 * Use a context-distinguishing prefix on the message to prevent the same key
 * from producing equivalent signatures across unrelated use cases.
 */
export async function hmacSignHex(secret, message) {
  const sig = await hmacSignRaw(secret, message);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time hex compare against an expected signature.
 * Returns false on length mismatch or any character difference.
 */
export async function hmacVerifyHex(secret, message, expectedHex) {
  if (!expectedHex || typeof expectedHex !== 'string') return false;
  const got = await hmacSignHex(secret, message);
  if (got.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}
