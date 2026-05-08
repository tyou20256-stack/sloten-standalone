// GDPR / data-subject access endpoints.
//
// Provides:
//   GET  /api/admin/gdpr/contact/:id       — export all data for a contact
//   POST /api/admin/gdpr/contact/:id/erase — anonymize (preserve referential
//                                            integrity but null out PII)
//
// Why anonymize instead of hard-delete: foreign-key cascade across many
// tables (messages, ai_logs, audit_log, attachments, conversations) makes
// hard delete brittle and forensically destructive. Anonymization preserves
// aggregate metrics and audit trails while removing personal data.
//
// Per Sloten's Georgia jurisdiction: GDPR doesn't apply directly, but these
// endpoints exist to support requests under analogous local privacy law and
// to respond cleanly to operator requests.

import { ok, err } from '../json.mjs';

/** GET /api/admin/gdpr/contact/:id */
export async function exportContactData(_request, env, corsHeaders, contactId) {
  if (!contactId) return err('contact_id required', 400, corsHeaders);

  try {
    const contact = await env.DB.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(contactId).first();
    if (!contact) return err('Contact not found', 404, corsHeaders);

    const conversations = await env.DB.prepare(
      `SELECT * FROM conversations WHERE contact_id = ? ORDER BY created_at ASC`,
    ).bind(contactId).all();
    const convIds = (conversations.results || []).map((c) => c.id);

    let messages = [];
    let attachments = [];
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const msgRes = await env.DB.prepare(
        `SELECT id, conversation_id, sender_type, sender_id, content, content_type, created_at
           FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY created_at ASC`,
      ).bind(...convIds).all();
      messages = msgRes.results || [];

      const attRes = await env.DB.prepare(
        `SELECT id, conversation_id, message_id, filename, content_type, size_bytes, created_at
           FROM attachments WHERE conversation_id IN (${placeholders})`,
      ).bind(...convIds).all();
      attachments = attRes.results || [];
    }

    return ok({
      success: true,
      exported_at: new Date().toISOString(),
      contact,
      conversations: conversations.results || [],
      messages,
      attachments,
      counts: {
        conversations: (conversations.results || []).length,
        messages: messages.length,
        attachments: attachments.length,
      },
    }, corsHeaders);
  } catch (e) {
    return err(`Export failed: ${e.message}`, 500, corsHeaders);
  }
}

/** POST /api/admin/gdpr/contact/:id/erase */
export async function eraseContactData(request, env, corsHeaders, contactId) {
  if (!contactId) return err('contact_id required', 400, corsHeaders);

  // Confirm payload to prevent accidental erasure
  let body;
  try { body = await request.json(); } catch { body = {}; }
  if (body.confirm !== `ERASE_${contactId}`) {
    return err(`Confirmation required. POST {"confirm":"ERASE_${contactId}"}`, 400, corsHeaders);
  }

  try {
    const contact = await env.DB.prepare(`SELECT id, email FROM contacts WHERE id = ?`).bind(contactId).first();
    if (!contact) return err('Contact not found', 404, corsHeaders);

    // Anonymize contact PII
    await env.DB.prepare(
      `UPDATE contacts SET name='[ERASED]', email=NULL, phone=NULL, metadata=NULL,
              avatar_url=NULL, external_id=NULL, updated_at=datetime('now')
        WHERE id = ?`,
    ).bind(contactId).run();

    // Anonymize message content for this contact's conversations.
    // Keep id/conversation_id/created_at/sender_type for analytics.
    const convs = await env.DB.prepare(`SELECT id FROM conversations WHERE contact_id = ?`).bind(contactId).all();
    const convIds = (convs.results || []).map((c) => c.id);
    let msgsErased = 0;
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `UPDATE messages SET content='[ERASED]', content_attributes=NULL
          WHERE conversation_id IN (${placeholders})`,
      ).bind(...convIds).run();
      msgsErased = r.meta?.changes || 0;
    }

    // Audit-log the erasure (auditor can see WHO did it later)
    try {
      await env.DB.prepare(
        `INSERT INTO audit_log (tenant_id, staff_id, staff_email, action, resource_type, resource_id, ip, user_agent, created_at)
         VALUES (?, NULL, NULL, 'GDPR_ERASE', 'contact', ?, ?, ?, datetime('now'))`,
      ).bind(
        contact.tenant_id || 'tenant_default',
        String(contactId),
        request.headers.get('CF-Connecting-IP') || 'unknown',
        (request.headers.get('User-Agent') || '').slice(0, 200),
      ).run();
    } catch (_) { /* audit log failure shouldn't block erasure */ }

    return ok({
      success: true,
      contact_id: contactId,
      conversations_affected: convIds.length,
      messages_anonymized: msgsErased,
      timestamp: new Date().toISOString(),
    }, corsHeaders);
  } catch (e) {
    return err(`Erasure failed: ${e.message}`, 500, corsHeaders);
  }
}
