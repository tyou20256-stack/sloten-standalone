// Contacts (widget end-users). Identified or anonymous.

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { issueContactToken } from '../auth/contact-token.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

function decorate(row) {
  if (!row) return row;
  return { ...row, is_identified: !!row.is_identified };
}

export async function createContact(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = body.tenant_id || env.DEFAULT_TENANT_ID || 'tenant_default';
  // Always server-generated — never trust body.id from a public widget endpoint.
  const id = uuid();
  const { email = null, phone = null, name = null, avatar_url = null } = body;
  const metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  const isIdentified = email || phone ? 1 : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO contacts (id, tenant_id, email, phone, name, avatar_url, metadata, is_identified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, tenantId, email, phone, name, avatar_url, metadata, isIdentified).run();
    const row = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
    // Issue an ownership token — required on all subsequent widget calls.
    const contact_token = await issueContactToken(env, id);
    return created({ success: true, contact: decorate(row), contact_token }, corsHeaders);
  } catch (e) {
    console.error('createContact:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function getContact(request, env, corsHeaders, id) {
  const row = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  if (!row) return err('Contact not found', 404, corsHeaders);
  return ok({ success: true, contact: decorate(row) }, corsHeaders);
}

export async function listContacts(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const { results } = await env.DB.prepare(
    'SELECT * FROM contacts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(tenantId, limit).all();
  return ok({ success: true, contacts: (results || []).map(decorate) }, corsHeaders);
}

// Past conversations for the same contact — Chatwoot-style "Previous conversations".
export async function listContactConversations(request, env, corsHeaders, contactId) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
  const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first();
  if (!contact) return err('Contact not found', 404, corsHeaders);
  const { results } = await env.DB.prepare(
    `SELECT id, status, assignee_id, last_message_at, last_message_preview, created_at, closed_at
       FROM conversations
      WHERE contact_id = ?
   ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT ?`
  ).bind(contactId, limit).all();
  return ok({
    success: true,
    contact: decorate(contact),
    conversations: results || [],
  }, corsHeaders);
}
