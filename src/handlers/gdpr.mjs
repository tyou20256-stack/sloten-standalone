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
import { revokeAllContactTokens } from '../auth/contact-token.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

/** GET /api/admin/gdpr/contact/:id */
export async function exportContactData(request, env, corsHeaders, contactId) {
  if (!contactId) return err('contact_id required', 400, corsHeaders);

  try {
    // Tenant-scoped: a tenant-A admin must not be able to export contact
    // PII belonging to tenant B by UUID guess (2026-05-13 audit, second pass).
    const tenantId = resolveTenantId(request, env);
    const contact = await env.DB.prepare(
      `SELECT * FROM contacts WHERE id = ? AND tenant_id = ?`,
    ).bind(contactId, tenantId).first();
    if (!contact) return err('Contact not found', 404, corsHeaders);

    // Audit-log the export — accessing all PII for a contact is a sensitive
    // action and must leave a trail equal to GDPR_ERASE.
    const staff = request.__staff || null;
    try {
      await env.DB.prepare(
        `INSERT INTO audit_log (tenant_id, staff_id, staff_email, action, resource_type, resource_id, ip, user_agent, created_at)
         VALUES (?, ?, ?, 'GDPR_EXPORT', 'contact', ?, ?, ?, datetime('now'))`,
      ).bind(
        contact.tenant_id || 'tenant_default',
        staff?.id ?? null,
        staff?.email ?? null,
        String(contactId),
        request.headers.get('CF-Connecting-IP') || 'unknown',
        (request.headers.get('User-Agent') || '').slice(0, 200),
      ).run();
    } catch (auditErr) {
      console.warn('[gdpr.export] audit_log failed:', auditErr?.message);
    }

    // All downstream queries are constrained to (contact_id, tenant_id) —
    // belt-and-braces over the contact tenant check above.
    const conversations = await env.DB.prepare(
      `SELECT * FROM conversations WHERE contact_id = ? AND tenant_id = ? ORDER BY created_at ASC`,
    ).bind(contactId, tenantId).all();
    const convIds = (conversations.results || []).map((c) => c.id);

    let messages = [];
    let attachments = [];
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const msgRes = await env.DB.prepare(
        `SELECT id, conversation_id, sender_type, sender_id, content, content_type, created_at
           FROM messages WHERE conversation_id IN (${placeholders}) AND tenant_id = ?
           ORDER BY created_at ASC`,
      ).bind(...convIds, tenantId).all();
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
    // Don't leak schema/PII through error messages.
    console.error('[gdpr.export] failed:', e?.message, e?.stack?.slice(0, 500));
    return err('Export failed', 500, corsHeaders);
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
    // Tenant-scoped: cross-tenant erase is the worst-case for this endpoint —
    // a tenant-A admin must not be able to wipe another tenant's customer
    // (2026-05-13 audit, second pass — was an explicit CWE-639 hit).
    const tenantId = resolveTenantId(request, env);
    const contact = await env.DB.prepare(
      `SELECT id, email, tenant_id FROM contacts WHERE id = ? AND tenant_id = ?`,
    ).bind(contactId, tenantId).first();
    if (!contact) return err('Contact not found', 404, corsHeaders);

    // Anonymize contact PII — scoped to the caller's tenant for defense in depth.
    await env.DB.prepare(
      `UPDATE contacts SET name='[ERASED]', email=NULL, phone=NULL, metadata=NULL,
              avatar_url=NULL, external_id=NULL, updated_at=datetime('now')
        WHERE id = ? AND tenant_id = ?`,
    ).bind(contactId, tenantId).run();

    // Revoke any outstanding widget tokens — without this, the contact's
    // localStorage-cached token would continue to work for up to 7 days,
    // letting a leaked-or-shared device write to the (now-erased) record.
    await revokeAllContactTokens(env, contactId);

    // Anonymize message content for this contact's conversations.
    // Keep id/conversation_id/created_at/sender_type for analytics.
    const convs = await env.DB.prepare(
      `SELECT id FROM conversations WHERE contact_id = ? AND tenant_id = ?`,
    ).bind(contactId, tenantId).all();
    const convIds = (convs.results || []).map((c) => c.id);
    let msgsErased = 0;
    let attsErased = 0;
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `UPDATE messages SET content='[ERASED]', content_attributes=NULL
          WHERE conversation_id IN (${placeholders}) AND tenant_id = ?`,
      ).bind(...convIds, tenantId).run();
      msgsErased = r.meta?.changes || 0;

      // Erase attachments — the previous gdpr.erase implementation left
      // R2 blobs AND the DB row filename intact. Customer-uploaded
      // attachments routinely contain ID photos / passport scans /
      // bank-statement screenshots — pure PII that GDPR right-to-erasure
      // applies to (2026-05-14 third-pass audit).
      const attRows = await env.DB.prepare(
        `SELECT id FROM attachments WHERE conversation_id IN (${placeholders})`,
      ).bind(...convIds).all();
      const attIds = (attRows.results || []).map((a) => a.id);
      if (attIds.length > 0 && env.FILES) {
        // Drop R2 objects best-effort — D1 rows below get anonymised either
        // way, so a partial R2 failure still leaves no DB pointer back to
        // the customer.
        for (const attId of attIds) {
          try { await env.FILES.delete(attId); }
          catch (delErr) { console.warn('[gdpr.erase] R2 delete failed for', attId, delErr?.message); }
        }
      }
      // Anonymise the DB row: keep id/conversation_id/timestamps so the
      // referential graph for audit + analytics stays intact, wipe filename
      // (likely PII) + checksum (could be used to re-identify if the same
      // file appears elsewhere).
      if (attIds.length > 0) {
        const attPlaceholders = attIds.map(() => '?').join(',');
        const ar = await env.DB.prepare(
          `UPDATE attachments SET filename='[ERASED]', checksum_sha256=NULL
            WHERE id IN (${attPlaceholders})`,
        ).bind(...attIds).run();
        attsErased = ar.meta?.changes || 0;
      }
    }

    // Audit-log the erasure (auditor can see WHO did it later).
    // request.__staff is injected by requireAdminRole — capture id+email so a
    // GDPR_ERASE has accountability even if the staff record is later deleted.
    const staff = request.__staff || null;
    try {
      await env.DB.prepare(
        `INSERT INTO audit_log (tenant_id, staff_id, staff_email, action, resource_type, resource_id, ip, user_agent, created_at)
         VALUES (?, ?, ?, 'GDPR_ERASE', 'contact', ?, ?, ?, datetime('now'))`,
      ).bind(
        contact.tenant_id || 'tenant_default',
        staff?.id ?? null,
        staff?.email ?? null,
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
      attachments_anonymized: attsErased,
      timestamp: new Date().toISOString(),
    }, corsHeaders);
  } catch (e) {
    console.error('[gdpr.erase] failed:', e?.message, e?.stack?.slice(0, 500));
    return err('Erasure failed', 500, corsHeaders);
  }
}
