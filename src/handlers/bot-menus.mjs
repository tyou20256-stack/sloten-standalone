// Bot menus CRUD + runtime match helpers.

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

const VALID_TYPES = new Set(['default', 'keyword', 'fallback']);

function parseItems(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try { const a = JSON.parse(items); return Array.isArray(a) ? a : null; } catch { return null; }
  }
  return null;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'items must be a non-empty array';
  if (items.length > 12) return 'items: at most 12 entries';
  for (const it of items) {
    if (!it || typeof it !== 'object') return 'each item must be an object';
    const title = String(it.title || '').trim();
    if (!title) return 'each item must have a non-empty title';
    if (title.length > 60) return 'title too long (max 60)';
  }
  return null;
}

function decorate(row) {
  if (!row) return row;
  return { ...row, items: parseItems(row.items) || [] };
}

export async function listBotMenus(request, env, corsHeaders) {
  const tenantId = resolveTenantId(request, env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM bot_menus WHERE tenant_id = ? ORDER BY priority DESC, id ASC'
  ).bind(tenantId).all();
  return ok({ success: true, menus: (results || []).map(decorate) }, corsHeaders);
}

export async function createBotMenu(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = resolveTenantId(request, env);
  const name = (body.name || '').trim();
  const triggerType = body.trigger_type;
  if (!name) return err('name required', 400, corsHeaders);
  if (!VALID_TYPES.has(triggerType)) return err('trigger_type must be default / keyword / fallback', 400, corsHeaders);
  if (triggerType === 'keyword') {
    const re = body.trigger_value;
    if (!re || typeof re !== 'string') return err('trigger_value (regex) required for keyword', 400, corsHeaders);
    try { new RegExp(re); } catch { return err('Invalid regex', 400, corsHeaders); }
  }
  const items = parseItems(body.items);
  const itemsErr = validateItems(items);
  if (itemsErr) return err(itemsErr, 400, corsHeaders);

  const r = await env.DB.prepare(
    `INSERT INTO bot_menus (tenant_id, name, trigger_type, trigger_value, prompt, items, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId, name, triggerType,
    triggerType === 'keyword' ? body.trigger_value : null,
    String(body.prompt || ''),
    JSON.stringify(items),
    parseInt(body.priority ?? 0, 10) || 0,
    body.is_active === false ? 0 : 1,
  ).run();
  const row = await env.DB.prepare('SELECT * FROM bot_menus WHERE id = ?').bind(r.meta.last_row_id).first();
  return created({ success: true, menu: decorate(row) }, corsHeaders);
}

export async function updateBotMenu(request, env, corsHeaders, id) {
  const existing = await env.DB.prepare('SELECT * FROM bot_menus WHERE id = ?').bind(id).first();
  if (!existing) return err('Bot menu not found', 404, corsHeaders);
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const updates = [];
  const vals = [];
  if (body.name !== undefined) { updates.push('name = ?'); vals.push(String(body.name).trim()); }
  if (body.trigger_type !== undefined) {
    if (!VALID_TYPES.has(body.trigger_type)) return err('Invalid trigger_type', 400, corsHeaders);
    updates.push('trigger_type = ?'); vals.push(body.trigger_type);
  }
  if (body.trigger_value !== undefined) {
    if (body.trigger_value) { try { new RegExp(body.trigger_value); } catch { return err('Invalid regex', 400, corsHeaders); } }
    updates.push('trigger_value = ?'); vals.push(body.trigger_value || null);
  }
  if (body.prompt !== undefined) { updates.push('prompt = ?'); vals.push(String(body.prompt)); }
  if (body.items !== undefined) {
    const items = parseItems(body.items);
    const itemsErr = validateItems(items);
    if (itemsErr) return err(itemsErr, 400, corsHeaders);
    updates.push('items = ?'); vals.push(JSON.stringify(items));
  }
  if (body.priority !== undefined) { updates.push('priority = ?'); vals.push(parseInt(body.priority, 10) || 0); }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE bot_menus SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM bot_menus WHERE id = ?').bind(id).first();
  return ok({ success: true, menu: decorate(row) }, corsHeaders);
}

export async function deleteBotMenu(request, env, corsHeaders, id) {
  await env.DB.prepare('DELETE FROM bot_menus WHERE id = ?').bind(id).run();
  return ok({ success: true }, corsHeaders);
}

// --- Runtime helpers (called from message / conversation pipelines) ---

export async function findDefaultMenu(env, tenantId) {
  const row = await env.DB.prepare(
    `SELECT * FROM bot_menus WHERE tenant_id = ? AND trigger_type = 'default' AND is_active = 1
     ORDER BY priority DESC, id ASC LIMIT 1`
  ).bind(tenantId).first();
  return decorate(row);
}

export async function findKeywordMenu(env, tenantId, userText) {
  const text = String(userText || '');
  if (!text) return null;
  const { results } = await env.DB.prepare(
    `SELECT * FROM bot_menus WHERE tenant_id = ? AND trigger_type = 'keyword' AND is_active = 1 AND trigger_value IS NOT NULL
     ORDER BY priority DESC, id ASC`
  ).bind(tenantId).all();
  for (const row of (results || [])) {
    try {
      const re = new RegExp(row.trigger_value);
      if (re.test(text)) return decorate(row);
    } catch { /* invalid regex at runtime — skip */ }
  }
  return null;
}

export async function findFallbackMenu(env, tenantId) {
  const row = await env.DB.prepare(
    `SELECT * FROM bot_menus WHERE tenant_id = ? AND trigger_type = 'fallback' AND is_active = 1
     ORDER BY priority DESC, id ASC LIMIT 1`
  ).bind(tenantId).first();
  return decorate(row);
}

export function menuToMessagePayload(menu) {
  if (!menu || !Array.isArray(menu.items)) return null;
  return {
    content: menu.prompt || 'ご用件をお選びください。',
    content_type: 'input_select',
    content_attributes: { items: menu.items },
  };
}
