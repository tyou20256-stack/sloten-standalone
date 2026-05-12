// Admin CRUD + submission history for bonus_codes.
//
// Routes (registered in src/index.mjs):
//   GET    /api/bonus-codes                -> list all (with codes, items, flags)
//   POST   /api/bonus-codes                -> create (source='dynamic')
//   PATCH  /api/bonus-codes/:id            -> partial update (any field)
//   DELETE /api/bonus-codes/:id            -> delete (only dynamic rows; hardcoded 403)
//   GET    /api/bonus-code-submissions     -> recent submissions (joins bonus_codes)

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';
import { bestEffortSync } from '../lib/best-effort.mjs';

const VALID_MATCH_MODES = new Set(['exact', 'case_insensitive']);

// Production parity (chatwoot-final-working v10.0): sheet_name forwarded to
// GAS so it can auto-create a per-event spreadsheet. Mirror the production
// validator: 1-100 chars, no newline / tab / [] / ? * : / \.
const SHEET_NAME_INVALID_RE = /[\r\n\t\[\]\?\*\:\/\\]/;
function isValidSheetName(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 1 || s.length > 100) return false;
  return !SHEET_NAME_INVALID_RE.test(s);
}

function decorate(row) {
  if (!row) return row;
  const parse = (s, fb) => {
    if (!s) return fb;
    const v = bestEffortSync('bonus-codes-admin:decorate', () => JSON.parse(s));
    return v === undefined ? fb : v;
  };
  return {
    ...row,
    codes: parse(row.codes, []),
    success_items: parse(row.success_items, []),
    enabled: !!row.enabled,
    transfer_after: !!row.transfer_after,
    game_selection: !!row.game_selection,
  };
}

export async function listBonusCodes(request, env, corsHeaders) {
  const tenantId = resolveTenantId(request, env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM bonus_codes WHERE tenant_id = ? ORDER BY priority DESC, id ASC`,
  ).bind(tenantId).all();
  return ok({ success: true, codes: (results || []).map(decorate) }, corsHeaders);
}

export async function createBonusCode(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = resolveTenantId(request, env);
  const errors = [];
  const typeKey = String(body.type_key || '').trim();
  const displayName = String(body.display_name || '').trim();
  const codes = Array.isArray(body.codes) ? body.codes.filter((c) => typeof c === 'string' && c.trim()) : null;
  const matchMode = body.match_mode || 'case_insensitive';
  const content = String(body.success_content || '').trim();
  const items = Array.isArray(body.success_items) ? body.success_items : null;
  if (!typeKey || !/^[a-z0-9_-]{1,50}$/i.test(typeKey)) errors.push('type_key (英数字_-, 1-50)');
  if (!displayName) errors.push('display_name');
  if (!codes || !codes.length) errors.push('codes (non-empty array)');
  if (!content) errors.push('success_content');
  if (!VALID_MATCH_MODES.has(matchMode)) errors.push('match_mode');
  // sheet_name is optional, but reject obviously invalid values when present.
  let sheetName = null;
  if (body.sheet_name !== undefined && body.sheet_name !== null && String(body.sheet_name).trim() !== '') {
    const trimmed = String(body.sheet_name).trim();
    if (!isValidSheetName(trimmed)) errors.push('sheet_name (1-100 chars, no newline/tab/[]/?*:/\\)');
    else sheetName = trimmed;
  }
  if (errors.length) return err('Invalid: ' + errors.join(', '), 400, corsHeaders);

  // Uniqueness check on type_key within tenant.
  const dup = await env.DB.prepare(
    `SELECT id FROM bonus_codes WHERE tenant_id = ? AND type_key = ?`,
  ).bind(tenantId, typeKey).first();
  if (dup) return err('type_key already exists', 409, corsHeaders);

  const r = await env.DB.prepare(
    `INSERT INTO bonus_codes (tenant_id, type_key, display_name, codes, match_mode, success_content, success_items, gas_type, transfer_after, enabled, source, priority, sheet_name, game_selection)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dynamic', ?, ?, ?)`,
  ).bind(
    tenantId, typeKey, displayName,
    JSON.stringify(codes), matchMode, content,
    items ? JSON.stringify(items) : null,
    body.gas_type || null,
    body.transfer_after ? 1 : 0,
    body.enabled === false ? 0 : 1,
    typeof body.priority === 'number' ? body.priority : 50,
    sheetName,
    body.game_selection ? 1 : 0,
  ).run();
  const row = await env.DB.prepare('SELECT * FROM bonus_codes WHERE id = ?').bind(r.meta.last_row_id).first();
  return created({ success: true, code: decorate(row) }, corsHeaders);
}

export async function updateBonusCode(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = resolveTenantId(request, env);
  // Always scope by tenant to prevent cross-tenant edits in a multi-tenant
  // deployment (shouldn't match today but defensive).
  const row = await env.DB.prepare('SELECT * FROM bonus_codes WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!row) return err('Not found', 404, corsHeaders);

  const sets = [];
  const vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if ('display_name' in body) set('display_name', String(body.display_name || ''));
  if ('codes' in body) {
    if (!Array.isArray(body.codes) || !body.codes.length) return err('codes must be a non-empty array', 400, corsHeaders);
    set('codes', JSON.stringify(body.codes.filter((c) => typeof c === 'string' && c.trim())));
  }
  if ('match_mode' in body) {
    if (!VALID_MATCH_MODES.has(body.match_mode)) return err('Invalid match_mode', 400, corsHeaders);
    set('match_mode', body.match_mode);
  }
  if ('success_content' in body) set('success_content', String(body.success_content || ''));
  if ('success_items' in body) {
    set('success_items', Array.isArray(body.success_items) && body.success_items.length
      ? JSON.stringify(body.success_items) : null);
  }
  if ('gas_type' in body) set('gas_type', body.gas_type || null);
  if ('transfer_after' in body) set('transfer_after', body.transfer_after ? 1 : 0);
  if ('enabled' in body) set('enabled', body.enabled ? 1 : 0);
  if ('priority' in body) set('priority', Number(body.priority) || 0);
  if ('sheet_name' in body) {
    const raw = body.sheet_name;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      set('sheet_name', null);
    } else {
      const trimmed = String(raw).trim();
      if (!isValidSheetName(trimmed)) return err('Invalid sheet_name (1-100 chars, no newline/tab/[]/?*:/\\)', 400, corsHeaders);
      set('sheet_name', trimmed);
    }
  }
  if ('game_selection' in body) set('game_selection', body.game_selection ? 1 : 0);

  if (!sets.length) return err('No fields to update', 400, corsHeaders);
  sets.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE bonus_codes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const updated = await env.DB.prepare('SELECT * FROM bonus_codes WHERE id = ?').bind(id).first();
  return ok({ success: true, code: decorate(updated) }, corsHeaders);
}

export async function deleteBonusCode(request, env, corsHeaders, id) {
  const tenantId = resolveTenantId(request, env);
  const row = await env.DB.prepare('SELECT * FROM bonus_codes WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!row) return err('Not found', 404, corsHeaders);
  if (row.source === 'hardcoded') {
    return err('ハードコード種別は削除できません (enabled=false で無効化してください)', 403, corsHeaders);
  }
  await env.DB.prepare('DELETE FROM bonus_codes WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return ok({ success: true }, corsHeaders);
}

export async function listBonusSubmissions(request, env, corsHeaders) {
  const tenantId = resolveTenantId(request, env);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const typeKey = url.searchParams.get('type_key');
  // Qualify column names because both `bonus_code_submissions` and
  // `contacts` have a `tenant_id` column — bare references are ambiguous
  // and SQLite throws (HTTP 500).
  const parts = [`s.tenant_id = ?`];
  const vals = [tenantId];
  if (typeKey) { parts.push(`s.type_key = ?`); vals.push(typeKey); }
  const q = `SELECT s.*, c.name AS contact_name, c.email AS contact_email
               FROM bonus_code_submissions s
          LEFT JOIN contacts c ON c.id = s.contact_id
              WHERE ${parts.join(' AND ')}
           ORDER BY s.created_at DESC LIMIT ?`;
  vals.push(limit);
  const { results } = await env.DB.prepare(q).bind(...vals).all();
  return ok({ success: true, submissions: results || [] }, corsHeaders);
}
