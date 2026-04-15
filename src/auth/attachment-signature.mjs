// HMAC-signed time-limited URLs for R2 attachments. Format:
//   /api/attachments/:id?sig=<hex>&exp=<unix_seconds>
// Signature = HMAC-SHA256(ATTACHMENT_SIGNING_KEY, `${id}.${exp}`)
// Falls back to SESSION_SIGNING_KEY if the dedicated key is unset (dev use).

const ENC = new TextEncoder();

function hexFromBuf(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getKey(env) {
  const secret = env.ATTACHMENT_SIGNING_KEY || env.SESSION_SIGNING_KEY;
  if (!secret) throw new Error('ATTACHMENT_SIGNING_KEY not set');
  return crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signAttachmentUrl(env, attachmentId, baseUrl, ttlSeconds) {
  const ttl = Math.max(60, parseInt(env.ATTACHMENT_URL_TTL_SECONDS || ttlSeconds || 86400, 10));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const key = await getKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(`${attachmentId}.${exp}`));
  const sigHex = hexFromBuf(sig);
  const u = new URL(`${baseUrl}/api/attachments/${attachmentId}`);
  u.searchParams.set('sig', sigHex);
  u.searchParams.set('exp', String(exp));
  return u.toString();
}

export async function verifyAttachmentSignature(env, attachmentId, sigHex, expStr) {
  if (!sigHex || !expStr) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  try {
    const key = await getKey(env);
    // Convert hex to bytes
    if (sigHex.length % 2 !== 0) return false;
    const bytes = new Uint8Array(sigHex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(sigHex.substr(i * 2, 2), 16);
    return await crypto.subtle.verify('HMAC', key, bytes, ENC.encode(`${attachmentId}.${exp}`));
  } catch { return false; }
}

export function baseUrlOf(request, env) {
  return env.PUBLIC_WORKER_URL || new URL(request.url).origin;
}
