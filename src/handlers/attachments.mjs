// Attachments — POST uploads to R2, GET streams from R2 with ownership checks.
// Limits: 10MB, image/* + application/pdf only.

import { uuid } from '../id.mjs';
import { ok, err } from '../json.mjs';
import { verifyAttachmentSignature } from '../auth/attachment-signature.mjs';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_PREFIXES = ['image/', 'application/pdf'];

function mimeOk(ct) {
  if (!ct) return false;
  const c = String(ct).toLowerCase();
  return ALLOWED_PREFIXES.some((p) => c === p || c.startsWith(p));
}
function extOk(name) {
  if (!name) return false;
  const low = String(name).toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg|pdf)$/.test(low);
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Widget upload: multipart/form-data with field "file" and "conversation_id".
// Caller ownership is verified by the router before entering this handler.
export async function uploadAttachment(request, env, corsHeaders, conversationId, who /* 'customer' | 'staff' */) {
  if (!env.FILES) return err('R2 not configured', 503, corsHeaders);
  const conv = await env.DB.prepare('SELECT id FROM conversations WHERE id = ?').bind(conversationId).first();
  if (!conv) return err('Conversation not found', 404, corsHeaders);

  let form;
  try { form = await request.formData(); } catch { return err('multipart/form-data required', 400, corsHeaders); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return err('file field required', 400, corsHeaders);

  const name = (file.name || 'upload').slice(0, 200);
  const ct = (file.type || 'application/octet-stream').slice(0, 120);
  if (!mimeOk(ct) && !extOk(name)) return err('Unsupported file type (image/* or application/pdf only)', 415, corsHeaders);
  if (file.size > MAX_BYTES) return err(`File too large (max ${MAX_BYTES} bytes)`, 413, corsHeaders);

  const id = uuid();
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return err('File too large', 413, corsHeaders);
  // Re-validate MIME against allowed list now that we have the bytes; still
  // accept if content_type looks image/pdf OR extension is image/pdf.
  if (!mimeOk(ct) && !extOk(name)) return err('Unsupported file type', 415, corsHeaders);

  const checksum = await sha256Hex(buffer);
  try {
    await env.FILES.put(id, buffer, {
      httpMetadata: { contentType: ct },
      customMetadata: { conversation_id: conversationId, filename: name, uploaded_by: who },
    });
  } catch (e) {
    console.error('[attachments] R2 put failed:', e.message);
    return err('Upload failed', 500, corsHeaders);
  }

  await env.DB.prepare(
    `INSERT INTO attachments (id, conversation_id, uploaded_by, filename, content_type, size_bytes, checksum_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, conversationId, who, name, ct, buffer.byteLength, checksum).run();

  const row = await env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first();
  return ok({ success: true, attachment: row }, corsHeaders);
}

// Verify a signed URL and stream the file if valid. Used by webhook callers
// (GAS, etc.) that don't carry a session cookie or contact token.
export async function downloadAttachmentSigned(request, env, corsHeaders, id) {
  const url = new URL(request.url);
  const sig = url.searchParams.get('sig');
  const exp = url.searchParams.get('exp');
  const ok2 = await verifyAttachmentSignature(env, id, sig, exp);
  if (!ok2) return err('Invalid or expired signature', 401, corsHeaders);
  return downloadAttachment(request, env, corsHeaders, id);
}

// Stream the file. Caller ownership is verified by the router before entering.
// Serves with inline Content-Disposition so images preview in browser.
export async function downloadAttachment(request, env, corsHeaders, id) {
  if (!env.FILES) return err('R2 not configured', 503, corsHeaders);
  const meta = await env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first();
  if (!meta) return err('Attachment not found', 404, corsHeaders);
  const obj = await env.FILES.get(id);
  if (!obj) return err('Attachment body missing', 410, corsHeaders);

  const headers = new Headers();
  headers.set('Content-Type', meta.content_type || 'application/octet-stream');
  headers.set('Content-Length', String(meta.size_bytes));
  // Sanitize filename for the Content-Disposition header.
  const safe = (meta.filename || 'file').replace(/[^\w.\-]/g, '_');
  headers.set('Content-Disposition', `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(meta.filename || 'file')}`);
  headers.set('Cache-Control', 'private, max-age=300');
  // Echo CORS allow-origin if present.
  if (corsHeaders['Access-Control-Allow-Origin']) {
    headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
    if (corsHeaders['Access-Control-Allow-Credentials']) headers.set('Access-Control-Allow-Credentials', corsHeaders['Access-Control-Allow-Credentials']);
    headers.set('Vary', 'Origin');
  }
  return new Response(obj.body, { status: 200, headers });
}

// Helper used by sendMessage when a caller attaches an existing attachment_id
// to a text message.
export async function linkAttachmentToMessage(env, attachmentId, messageId, conversationId) {
  await env.DB.prepare(
    `UPDATE attachments SET message_id = ? WHERE id = ? AND conversation_id = ?`
  ).bind(messageId, attachmentId, conversationId).run();
}

// Helper for list queries — attach file metadata to messages that carry a
// content_attributes.attachment_id.
export async function fetchAttachmentsForMessages(env, messages) {
  if (!messages || messages.length === 0) return messages;
  const ids = [];
  for (const m of messages) {
    try {
      const attrs = typeof m.content_attributes === 'string' ? JSON.parse(m.content_attributes) : m.content_attributes;
      const aid = attrs?.attachment_id;
      if (aid) ids.push(aid);
    } catch (_) {}
  }
  if (ids.length === 0) return messages;
  const ph = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, filename, content_type, size_bytes FROM attachments WHERE id IN (${ph})`
  ).bind(...ids).all();
  const byId = {};
  for (const r of (results || [])) byId[r.id] = r;
  return messages.map((m) => {
    try {
      const attrs = typeof m.content_attributes === 'string' ? JSON.parse(m.content_attributes) : m.content_attributes;
      const aid = attrs?.attachment_id;
      if (aid && byId[aid]) {
        return { ...m, attachment: byId[aid] };
      }
    } catch (_) {}
    return m;
  });
}
