// Global search across conversations, messages, contacts (LIKE-based).

import { ok, err } from '../json.mjs';

export async function searchHandler(request, env, corsHeaders) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const tenantId = url.searchParams.get('tenant_id') || env.DEFAULT_TENANT_ID || 'tenant_default';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
  if (q.length < 1) return ok({ success: true, query: q, conversations: [], messages: [], contacts: [] }, corsHeaders);

  const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;

  try {
    // Conversations: match last_message_preview OR contact name/email/phone
    const convRes = await env.DB.prepare(`
      SELECT c.*, ct.name AS contact_name, ct.email AS contact_email
        FROM conversations c
        LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.tenant_id = ?
         AND (c.last_message_preview LIKE ? ESCAPE '\\'
           OR ct.name  LIKE ? ESCAPE '\\'
           OR ct.email LIKE ? ESCAPE '\\'
           OR ct.phone LIKE ? ESCAPE '\\')
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT ?
    `).bind(tenantId, like, like, like, like, limit).all();

    // Messages: match content; include conversation_id so UI can jump
    const msgRes = await env.DB.prepare(`
      SELECT m.id, m.conversation_id, m.sender_type, m.content, m.created_at
        FROM messages m
       WHERE m.tenant_id = ?
         AND m.content LIKE ? ESCAPE '\\'
    ORDER BY m.created_at DESC
       LIMIT ?
    `).bind(tenantId, like, limit).all();

    // Contacts: match name/email/phone/metadata
    const ctRes = await env.DB.prepare(`
      SELECT * FROM contacts
       WHERE tenant_id = ?
         AND (name  LIKE ? ESCAPE '\\'
           OR email LIKE ? ESCAPE '\\'
           OR phone LIKE ? ESCAPE '\\'
           OR metadata LIKE ? ESCAPE '\\')
    ORDER BY created_at DESC
       LIMIT ?
    `).bind(tenantId, like, like, like, like, limit).all();

    return ok({
      success: true,
      query: q,
      conversations: convRes.results || [],
      messages: msgRes.results || [],
      contacts: ctRes.results || [],
    }, corsHeaders);
  } catch (e) {
    console.error('[search]', e.message);
    return err('Search failed', 500, corsHeaders);
  }
}
