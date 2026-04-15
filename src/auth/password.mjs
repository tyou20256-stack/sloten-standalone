// PBKDF2-SHA256, 100k iterations, 16-byte salt, 32-byte derived key.
// Matches v1.0 (chatwoot-ai-cloudflare) so staff hashes can be migrated.

const ITER = 100_000;
const HASH = 'SHA-256';
const KEYLEN = 32;
const SALTLEN = 16;

const b64 = {
  encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  },
  decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

async function derive(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: HASH }, key, KEYLEN * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALTLEN));
  const hash = await derive(password, salt);
  return { password_hash: b64.encode(hash), password_salt: b64.encode(salt) };
}

export async function verifyPassword(password, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  try {
    const salt = b64.decode(storedSalt);
    const expected = b64.decode(storedHash);
    const actual = await derive(password, salt);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
