// src/handlers/golden-set.mjs
// Golden Set CRUD + evaluation-results viewing.
// Corpus used by scripts/eval-golden-set.mjs for offline regression testing.

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

export async function listGoldenSet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const category = url.searchParams.get('category');
  let q = `SELECT * FROM golden_set WHERE tenant_id = ?`;
  const vals = [tenantId];
  if (category) { q += ' AND category = ?'; vals.push(category); }
  q += ' ORDER BY id ASC LIMIT 500';
  const { results } = await env.DB.prepare(q).bind(...vals).all();
  return ok({ success: true, rows: results || [] }, corsHeaders);
}

export async function createGoldenRow(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = resolveTenantId(request, env);
  const { category, question, reference_answer, must_contain, must_not_contain, expected_kb_ids, expected_escalation, notes } = body;
  if (!category || !question) return err('category + question required', 400, corsHeaders);
  const r = await env.DB.prepare(
    `INSERT INTO golden_set (tenant_id, category, question, reference_answer, must_contain, must_not_contain, expected_kb_ids, expected_escalation, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    tenantId,
    category,
    question,
    reference_answer || null,
    must_contain ? JSON.stringify(must_contain) : null,
    must_not_contain ? JSON.stringify(must_not_contain) : null,
    expected_kb_ids ? JSON.stringify(expected_kb_ids) : null,
    expected_escalation ? 1 : 0,
    notes || null,
  ).run();
  return created({ success: true, id: r?.meta?.last_row_id }, corsHeaders);
}

export async function updateGoldenRow(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const sets = [];
  const binds = [];
  const apply = (col, val, stringify = false) => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    binds.push(val === null ? null : (stringify ? JSON.stringify(val) : val));
  };
  apply('category', body.category);
  apply('question', body.question);
  apply('reference_answer', body.reference_answer);
  apply('must_contain', body.must_contain, true);
  apply('must_not_contain', body.must_not_contain, true);
  apply('expected_kb_ids', body.expected_kb_ids, true);
  if (body.expected_escalation !== undefined) {
    sets.push('expected_escalation = ?');
    binds.push(body.expected_escalation ? 1 : 0);
  }
  apply('notes', body.notes);
  if (!sets.length) return err('no fields to update', 400, corsHeaders);
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);
  await env.DB.prepare(`UPDATE golden_set SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  const row = await env.DB.prepare('SELECT * FROM golden_set WHERE id = ?').bind(id).first();
  return ok({ success: true, row }, corsHeaders);
}

export async function deleteGoldenRow(request, env, corsHeaders, id) {
  await env.DB.prepare('DELETE FROM golden_set WHERE id = ?').bind(id).run();
  return ok({ success: true }, corsHeaders);
}

// Returns aggregated eval results: per-prompt latest batch summary.
export async function evalResults(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(
    `SELECT p.id AS prompt_id, p.name AS prompt_name,
            COUNT(*) AS n,
            AVG(e.keyword_inclusion_score) AS avg_keyword_score,
            SUM(e.must_not_contain_violated) AS total_violations,
            SUM(e.expected_escalation_match) AS esc_match,
            AVG(e.judge_score) AS avg_judge,
            AVG(e.latency_ms) AS avg_latency,
            MAX(e.run_at) AS latest_run
       FROM golden_eval e
       JOIN ai_prompts p ON p.id = e.prompt_id
      WHERE e.run_at > datetime('now', '-30 days')
      GROUP BY p.id ORDER BY latest_run DESC`,
  ).all();
  return ok({ success: true, prompts: results || [] }, corsHeaders);
}

// Shadow mode settings (backed by feature_flags).
export async function getShadowConfig(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM feature_flags WHERE key LIKE 'ai.shadow_mode.%'`,
  ).all();
  const cfg = {};
  for (const r of (results || [])) cfg[r.key] = r.value;
  return ok({ success: true, config: cfg }, corsHeaders);
}

export async function setShadowConfig(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const allowed = ['ai.shadow_mode.enabled', 'ai.shadow_mode.prompt_ids'];
  for (const k of Object.keys(body || {})) {
    if (!allowed.includes(k)) continue;
    await env.DB.prepare(
      `INSERT INTO feature_flags (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(k, String(body[k])).run();
  }
  return ok({ success: true }, corsHeaders);
}
