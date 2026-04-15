// AI prompt CRUD + weighted random selection for A/B testing.

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

export async function listPrompts(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const rows = (await env.DB.prepare(
    'SELECT * FROM ai_prompts WHERE tenant_id = ? ORDER BY is_active DESC, weight DESC, id ASC'
  ).bind(tenantId).all()).results || [];

  // Per-prompt thumbs aggregate for quality comparison
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const { results: stats } = await env.DB.prepare(
      `SELECT l.prompt_id,
              SUM(CASE WHEN f.rating = 1 THEN 1 ELSE 0 END) up,
              SUM(CASE WHEN f.rating = -1 THEN 1 ELSE 0 END) down,
              COUNT(DISTINCT l.id) calls
         FROM ai_logs l
         LEFT JOIN ai_log_feedback f ON f.ai_log_id = l.id
        WHERE l.prompt_id IN (${ph})
     GROUP BY l.prompt_id`
    ).bind(...ids).all();
    const byId = {};
    for (const s of (stats || [])) byId[s.prompt_id] = { up: s.up || 0, down: s.down || 0, calls: s.calls || 0 };
    for (const r of rows) r.stats = byId[r.id] || { up: 0, down: 0, calls: 0 };
  }
  return ok({ success: true, prompts: rows }, corsHeaders);
}

export async function createPrompt(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const name = (body.name || '').trim();
  const sp = (body.system_prompt || '').trim();
  if (!name || !sp) return err('name and system_prompt required', 400, corsHeaders);
  const weight = Math.max(0, Math.min(100, parseInt(body.weight ?? 50, 10)));
  const r = await env.DB.prepare(
    `INSERT INTO ai_prompts (tenant_id, name, description, system_prompt, weight, is_active) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.tenant_id || env.DEFAULT_TENANT_ID || 'tenant_default',
    name, body.description || null, sp, weight, body.is_active === false ? 0 : 1
  ).run();
  const row = await env.DB.prepare('SELECT * FROM ai_prompts WHERE id = ?').bind(r.meta.last_row_id).first();
  return created({ success: true, prompt: row }, corsHeaders);
}

export async function updatePrompt(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const updates = [];
  const vals = [];
  if (body.name !== undefined) { updates.push('name = ?'); vals.push(String(body.name).trim()); }
  if (body.description !== undefined) { updates.push('description = ?'); vals.push(body.description || null); }
  if (body.system_prompt !== undefined) { updates.push('system_prompt = ?'); vals.push(String(body.system_prompt)); }
  if (body.weight !== undefined) {
    const w = Math.max(0, Math.min(100, parseInt(body.weight, 10)));
    updates.push('weight = ?'); vals.push(w);
  }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE ai_prompts SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM ai_prompts WHERE id = ?').bind(id).first();
  if (!row) return err('Prompt not found', 404, corsHeaders);
  return ok({ success: true, prompt: row }, corsHeaders);
}

export async function deletePrompt(request, env, corsHeaders, id) {
  await env.DB.prepare('DELETE FROM ai_prompts WHERE id = ?').bind(id).run();
  return ok({ success: true }, corsHeaders);
}

// Internal: pick an active prompt using weighted-random; falls back to null
// if no active prompts exist (adapter will use its hard-coded default).
export async function pickActivePrompt(env, tenantId) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, system_prompt, weight FROM ai_prompts WHERE tenant_id = ? AND is_active = 1 AND weight > 0'
  ).bind(tenantId || 'tenant_default').all();
  const rows = results || [];
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let pick = Math.random() * total;
  for (const r of rows) {
    if (pick < r.weight) return r;
    pick -= r.weight;
  }
  return rows[rows.length - 1];
}
