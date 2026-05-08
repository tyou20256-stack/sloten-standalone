// Shared cryptographic primitives.
//
// Currently consolidates the HMAC-SHA256 helpers that announcements.mjs uses
// for KV cache integrity. session.mjs / contact-token.mjs deliberately use
// their own base64url-output variant tightly coupled to the JWT-like token
// format; switching them to a shared helper would risk session breakage and
// is left as future work. The hex variant here is for new HMAC use cases
// (cache integrity, signed URLs etc).

const ENC = new TextEncoder();

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    ENC.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * HMAC-SHA256 sign — returns hex (64 chars).
 * Use a context-distinguishing prefix on the message to prevent the same key
 * from producing equivalent signatures across unrelated use cases.
 */
export async function hmacSignHex(secret, message) {
  if (!secret) throw new Error('hmacSignHex: secret required');
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(message));
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
