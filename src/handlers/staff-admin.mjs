// Staff CRUD — admin role only. Password is auto-generated on create / reset
// and returned exactly once in the response (not retrievable later).

import { ok, created, err, parseJson } from '../json.mjs';
import { hashPassword } from '../auth/password.mjs';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#%&';
const VALID_ROLES = new Set(['admin', 'agent', 'viewer']);

function randomPassword(len = 22) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

function sanitize(row) {
  if (!row) return row;
  const { password_hash, password_salt, session_token_hash, ...rest } = row;
  return rest;
}

export async function listStaff(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM staff_members ORDER BY role DESC, id ASC'
  ).all();
  return ok({ success: true, staff: (results || []).map(sanitize) }, corsHeaders);
}

export async function createStaff(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const email = (body.email || '').toLowerCase().trim();
  const name = (body.name || '').trim() || email.split('@')[0];
  const role = body.role || 'agent';
  if (!email.includes('@')) return err('Invalid email', 400, corsHeaders);
  if (!VALID_ROLES.has(role)) return err('Invalid role', 400, corsHeaders);

  const existing = await env.DB.prepare('SELECT id FROM staff_members WHERE lower(email) = ?').bind(email).first();
  if (existing) return err('Staff with this email already exists', 409, corsHeaders);

  const password = randomPassword();
  const { password_hash, password_salt } = await hashPassword(password);

  const r = await env.DB.prepare(
    `INSERT INTO staff_members (email, name, role, password_hash, password_salt, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).bind(email, name, role, password_hash, password_salt).run();
  const row = await env.DB.prepare('SELECT * FROM staff_members WHERE id = ?').bind(r.meta.last_row_id).first();
  return created({ success: true, staff: sanitize(row), password }, corsHeaders);
}

export async function updateStaff(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const updates = [];
  const vals = [];
  if (body.name !== undefined)      { updates.push('name = ?');      vals.push(String(body.name).trim()); }
  if (body.role !== undefined) {
    if (!VALID_ROLES.has(body.role)) return err('Invalid role', 400, corsHeaders);
    updates.push('role = ?'); vals.push(body.role);
  }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (body.department !== undefined){ updates.push('department = ?');vals.push(body.department || null); }
  if (body.phone !== undefined)     { updates.push('phone = ?');     vals.push(body.phone || null); }
  if (body.language !== undefined)  { updates.push('language = ?');  vals.push(body.language || 'ja'); }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE staff_members SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first();
  if (!row) return err('Staff not found', 404, corsHeaders);
  return ok({ success: true, staff: sanitize(row) }, corsHeaders);
}

export async function deleteStaff(request, env, corsHeaders, id) {
  const existing = await env.DB.prepare('SELECT id FROM staff_members WHERE id = ?').bind(id).first();
  if (!existing) return err('Staff not found', 404, corsHeaders);
  // Self-delete guard
  const self = request.__staff;
  if (self && self.id === id) return err('Cannot delete your own account', 400, corsHeaders);
  // Null out assignee on their conversations (soft cascade)
  await env.DB.prepare('UPDATE conversations SET assignee_id = NULL, updated_at = datetime(\'now\') WHERE assignee_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
  return ok({ success: true }, corsHeaders);
}

export async function resetStaffPassword(request, env, corsHeaders, id) {
  const existing = await env.DB.prepare('SELECT id, email FROM staff_members WHERE id = ?').bind(id).first();
  if (!existing) return err('Staff not found', 404, corsHeaders);
  const password = randomPassword();
  const { password_hash, password_salt } = await hashPassword(password);
  await env.DB.prepare(
    `UPDATE staff_members
        SET password_hash = ?, password_salt = ?,
            session_token_hash = NULL, session_expires_at = NULL,
            failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?`
  ).bind(password_hash, password_salt, id).run();
  return ok({ success: true, email: existing.email, password }, corsHeaders);
}
