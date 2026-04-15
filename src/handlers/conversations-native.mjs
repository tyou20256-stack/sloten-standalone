// Conversations — standalone (no Chatwoot).

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { broadcastToConversation } from '../broadcast.mjs';

const VALID_STATUS = new Set(['bot', 'open', 'closed']);
const VALID_PRIORITY = new Set(['low', 'normal', 'high', 'urgent']);

function normalizeLabels(input) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(Boolean).join(',');
  }
  if (typeof input === 'string') {
    return input.split(',').map((s) => s.trim()).filter(Boolean).join(',');
  }
  return null;
}

export async function createConversation(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = body.tenant_id || env.DEFAULT_TENANT_ID || 'tenant_default';
  const contactId = body.contact_id;
  if (!contactId) return err('contact_id required', 400, corsHeaders);

  const contact = await env.DB.prepare('SELECT id FROM contacts WHERE id = ? AND tenant_id = ?')
    .bind(contactId, tenantId).first();
  if (!contact) return err('Contact not found', 404, corsHeaders);

  const id = uuid();
  const metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  try {
    await env.DB.prepare(
      `INSERT INTO conversations (id, tenant_id, contact_id, status, metadata)
       VALUES (?, ?, ?, 'bot', ?)`
    ).bind(id, tenantId, contactId, metadata).run();
    const row = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
    return created({ success: true, conversation: row }, corsHeaders);
  } catch (e) {
    console.error('createConversation:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function listConversations(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || env.DEFAULT_TENANT_ID || 'tenant_default';
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const label = url.searchParams.get('label');
  const teamId = url.searchParams.get('team_id');
  const snoozed = url.searchParams.get('snoozed'); // '1' = only snoozed, '0' = exclude snoozed
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  let q = 'SELECT * FROM conversations WHERE tenant_id = ?';
  const vals = [tenantId];
  if (status && VALID_STATUS.has(status)) { q += ' AND status = ?'; vals.push(status); }
  if (priority && VALID_PRIORITY.has(priority)) { q += ' AND priority = ?'; vals.push(priority); }
  if (label) {
    q += ` AND (',' || COALESCE(labels,'') || ',') LIKE ?`;
    vals.push(`%,${label},%`);
  }
  if (teamId) { q += ' AND team_id = ?'; vals.push(parseInt(teamId, 10)); }
  if (snoozed === '1') q += ` AND snoozed_until IS NOT NULL AND snoozed_until > datetime('now')`;
  else if (snoozed === '0') q += ` AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))`;
  q += ' ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ?';
  vals.push(limit);
  const { results } = await env.DB.prepare(q).bind(...vals).all();
  return ok({ success: true, conversations: results || [] }, corsHeaders);
}

export async function getConversation(request, env, corsHeaders, id) {
  const row = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!row) return err('Conversation not found', 404, corsHeaders);
  const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.contact_id).first();
  return ok({ success: true, conversation: row, contact }, corsHeaders);
}

export async function updateConversation(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const existing = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!existing) return err('Conversation not found', 404, corsHeaders);

  const updates = [];
  const vals = [];
  if (body.status !== undefined) {
    if (!VALID_STATUS.has(body.status)) return err('Invalid status', 400, corsHeaders);
    updates.push('status = ?');
    vals.push(body.status);
    if (body.status === 'closed') updates.push(`closed_at = datetime('now')`);
  }
  if (body.assignee_id !== undefined) {
    updates.push('assignee_id = ?');
    vals.push(body.assignee_id || null);
  }
  if (body.priority !== undefined) {
    if (!VALID_PRIORITY.has(body.priority)) return err('Invalid priority', 400, corsHeaders);
    updates.push('priority = ?');
    vals.push(body.priority);
  }
  if (body.labels !== undefined) {
    const normalized = normalizeLabels(body.labels);
    if (normalized == null) return err('Invalid labels', 400, corsHeaders);
    updates.push('labels = ?');
    vals.push(normalized);
  }
  if (body.team_id !== undefined) {
    updates.push('team_id = ?');
    vals.push(body.team_id == null ? null : parseInt(body.team_id, 10));
  }
  if (body.snoozed_until !== undefined) {
    // Accept null (unsnoozed), ISO string, or 'YYYY-MM-DD HH:MM:SS'.
    updates.push('snoozed_until = ?');
    if (body.snoozed_until == null) {
      vals.push(null);
    } else {
      const d = new Date(body.snoozed_until);
      if (isNaN(d.getTime())) return err('Invalid snoozed_until', 400, corsHeaders);
      // Store as SQLite-friendly 'YYYY-MM-DD HH:MM:SS' (UTC)
      vals.push(d.toISOString().slice(0, 19).replace('T', ' '));
    }
  }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  try {
    await broadcastToConversation(env, id, { type: 'conversation.updated', conversation: row });
  } catch (_) { /* swallow */ }
  return ok({ success: true, conversation: row }, corsHeaders);
}

// Mark conversation as read for staff — zero the staff unread counter.
export async function markRead(request, env, corsHeaders, id) {
  const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!conv) return err('Conversation not found', 404, corsHeaders);
  await env.DB.prepare(`UPDATE conversations SET unread_count_staff = 0, updated_at = datetime('now') WHERE id = ?`)
    .bind(id).run();
  return ok({ success: true }, corsHeaders);
}
