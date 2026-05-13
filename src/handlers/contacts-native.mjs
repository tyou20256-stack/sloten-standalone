// Contacts (widget end-users). Identified or anonymous.

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { issueContactToken, verifyContactToken, extractContactToken } from '../auth/contact-token.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';
import { bestEffortSync } from '../lib/best-effort.mjs';

function decorate(row) {
  if (!row) return row;
  return { ...row, is_identified: !!row.is_identified };
}

// Pick the host-provided identifier, mirroring Chatwoot's `setUser(identifier)`.
// Accept both top-level `identifier` (Chatwoot-compat) and nested
// `metadata.external_id` (legacy widget data-attr). Strip prefixes that would
// collide with Chatwoot migration pointers ("chatwoot:3:contact:xxxxx").
function pickIdentifier(body) {
  const direct = body?.identifier;
  const fromMeta = body?.metadata?.external_id || body?.metadata?.identifier;
  const raw = (direct != null ? String(direct) : (fromMeta != null ? String(fromMeta) : '')).trim();
  if (!raw) return null;
  if (raw.startsWith('chatwoot:')) return null; // reserved prefix, don't let widget set it
  return raw.slice(0, 255);
}

export async function createContact(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  // Tenant resolution for the public widget endpoint:
  // - If a staff session is present, lock to that staff's tenant.
  // - Else if the request Origin matches a configured tenant mapping, use it.
  // - Else fall back to env.DEFAULT_TENANT_ID.
  // Body-supplied tenant_id is IGNORED — anonymous clients must not be able
  // to inject contacts into a tenant of their choosing (CWE-639/284, audit
  // 2026-05-09 re-eval). Multi-tenant deploys should add a per-Origin
  // ALLOWED_WIDGET_TENANTS env binding instead of accepting body.tenant_id.
  let tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  if (request.__staff?.tenant_id) {
    tenantId = request.__staff.tenant_id;
  }
  // Always server-generated — never trust body.id from a public widget endpoint.
  const id = uuid();
  const { email = null, phone = null, name = null, avatar_url = null } = body;
  const externalId = pickIdentifier(body);
  const metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  const isIdentified = (email || phone || externalId) ? 1 : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO contacts (id, tenant_id, email, phone, name, avatar_url, metadata, is_identified, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, tenantId, email, phone, name, avatar_url, metadata, isIdentified, externalId).run();
    const row = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
    // Issue an ownership token — required on all subsequent widget calls.
    const contact_token = await issueContactToken(env, id);
    return created({ success: true, contact: decorate(row), contact_token }, corsHeaders);
  } catch (e) {
    console.error('createContact:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

// Runtime profile update — mirrors Chatwoot's `window.$chatwoot.setUser()`.
// Requires the contact_token issued at createContact (same ownership check as
// other widget endpoints). Only updates fields present in the body; null/empty
// string values clear the column.
export async function updateContact(request, env, corsHeaders, contactId) {
  const token = extractContactToken(request);
  const payload = await verifyContactToken(env, token);
  if (!payload) return err('Unauthorized (widget contact token required)', 401, corsHeaders);
  if (payload.cid !== contactId) return err('Forbidden (contact mismatch)', 403, corsHeaders);

  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;

  const sets = [];
  const binds = [];
  const apply = (col, val) => {
    if (val === undefined) return; // field not present — leave unchanged
    sets.push(`${col} = ?`);
    binds.push(val === null || val === '' ? null : val);
  };
  apply('name',       body.name);
  apply('email',      body.email);
  apply('phone',      body.phone);
  apply('avatar_url', body.avatar_url);

  const newIdentifier = pickIdentifier(body);
  if (body.identifier !== undefined || body.metadata?.external_id !== undefined || body.metadata?.identifier !== undefined) {
    apply('external_id', newIdentifier);
  }
  if (body.metadata !== undefined) {
    // Merge metadata with existing row so partial updates don't clobber prior keys.
    const existing = await env.DB.prepare('SELECT metadata FROM contacts WHERE id = ?').bind(contactId).first();
    const merged = (existing?.metadata
      ? bestEffortSync('contacts:updateContact:merge', () => JSON.parse(existing.metadata))
      : null) || {};
    if (body.metadata && typeof body.metadata === 'object') Object.assign(merged, body.metadata);
    apply('metadata', JSON.stringify(merged));
  }

  // Re-compute is_identified if any identity-bearing field was touched.
  if (sets.length) {
    const row = await env.DB.prepare('SELECT email, phone, external_id FROM contacts WHERE id = ?').bind(contactId).first();
    if (!row) return err('Contact not found', 404, corsHeaders);
    const next = {
      email: body.email !== undefined ? body.email : row.email,
      phone: body.phone !== undefined ? body.phone : row.phone,
      external_id: (body.identifier !== undefined || body.metadata?.external_id !== undefined) ? newIdentifier : row.external_id,
    };
    sets.push('is_identified = ?');
    binds.push((next.email || next.phone || next.external_id) ? 1 : 0);
    sets.push(`updated_at = datetime('now')`);
    binds.push(contactId);
    await env.DB.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  const updated = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first();
  if (!updated) return err('Contact not found', 404, corsHeaders);
  return ok({ success: true, contact: decorate(updated) }, corsHeaders);
}

export async function getContact(request, env, corsHeaders, id) {
  // Tenant-scoped: prevent cross-tenant contact PII read via UUID guess.
  const tenantId = resolveTenantId(request, env);
  const row = await env.DB.prepare(
    'SELECT * FROM contacts WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first();
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
  // Tenant-scoped: gate the contact lookup, then constrain the conversation
  // query to the same tenant so a cross-tenant contact_id (impossible if the
  // contact fetch above succeeded, but defense in depth) cannot leak rows.
  const tenantId = resolveTenantId(request, env);
  const contact = await env.DB.prepare(
    'SELECT * FROM contacts WHERE id = ? AND tenant_id = ?',
  ).bind(contactId, tenantId).first();
  if (!contact) return err('Contact not found', 404, corsHeaders);
  const { results } = await env.DB.prepare(
    `SELECT id, status, assignee_id, last_message_at, last_message_preview, created_at, closed_at
       FROM conversations
      WHERE contact_id = ? AND tenant_id = ?
   ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT ?`
  ).bind(contactId, tenantId, limit).all();
  return ok({
    success: true,
    contact: decorate(contact),
    conversations: results || [],
  }, corsHeaders);
}
