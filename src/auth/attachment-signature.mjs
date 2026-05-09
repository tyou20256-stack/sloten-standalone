// HMAC-signed time-limited URLs for R2 attachments. Format:
//   /api/attachments/:id?sig=<hex>&exp=<unix_seconds>&cid=<conversation_id>
// Signature = HMAC-SHA256(ATTACHMENT_SIGNING_KEY, `${id}.${cid}.${exp}`)
// Falls back to SESSION_SIGNING_KEY if the dedicated key is unset (dev use).
//
// Conversation binding (added 2026-05-09 audit, CWE-639):
//   The signature payload now includes conversation_id so a leaked URL only
//   works for the conversation it was issued from. Attachments in a different
//   conversation can't be fetched even with a valid sig. Legacy URLs without
//   `cid` parameter remain valid for backwards compat with widget clients
//   that cached pre-2026-05-09 links.
//
// TTL changed: 24h → 1h default. Attachments are typically displayed once
// then forgotten; long TTLs only widen the leak-replay window.

const ENC = new TextEncoder();
const DEFAULT_TTL_SECONDS = 3600; // 1h

function hexFromBuf(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getKey(env) {
  const secret = env.ATTACHMENT_SIGNING_KEY || env.SESSION_SIGNING_KEY;
  if (!secret) throw new Error('ATTACHMENT_SIGNING_KEY not set');
  return crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * Sign a URL for `attachmentId`. Pass `conversationId` to bind the signature
 * to a specific conversation (recommended). Legacy callers without it continue
 * to produce conversation-agnostic URLs (kept for backcompat — verify accepts
 * either format).
 */
export async function signAttachmentUrl(env, attachmentId, baseUrl, ttlSeconds, conversationId) {
  const ttl = Math.max(60, parseInt(env.ATTACHMENT_URL_TTL_SECONDS || ttlSeconds || DEFAULT_TTL_SECONDS, 10));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const key = await getKey(env);
  const cid = conversationId ? String(conversationId) : '';
  // Payload includes cid (empty for legacy / unbound URLs).
  const payload = cid ? `${attachmentId}.${cid}.${exp}` : `${attachmentId}.${exp}`;
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payload));
  const sigHex = hexFromBuf(sig);
  const u = new URL(`${baseUrl}/api/attachments/${attachmentId}`);
  u.searchParams.set('sig', sigHex);
  u.searchParams.set('exp', String(exp));
  if (cid) u.searchParams.set('cid', cid);
  return u.toString();
}

export async function verifyAttachmentSignature(env, attachmentId, sigHex, expStr, conversationId) {
  if (!sigHex || !expStr) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  try {
    const key = await getKey(env);
    // Convert hex to bytes
    if (sigHex.length % 2 !== 0) return false;
    const bytes = new Uint8Array(sigHex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(sigHex.substr(i * 2, 2), 16);
    // Try the bound payload first (preferred), fall back to legacy unbound.
    if (conversationId) {
      const bound = `${attachmentId}.${conversationId}.${exp}`;
      if (await crypto.subtle.verify('HMAC', key, bytes, ENC.encode(bound))) return true;
    }
    const legacy = `${attachmentId}.${exp}`;
    return await crypto.subtle.verify('HMAC', key, bytes, ENC.encode(legacy));
  } catch { return false; }
}

export function baseUrlOf(request, env) {
  return env.PUBLIC_WORKER_URL || new URL(request.url).origin;
}
