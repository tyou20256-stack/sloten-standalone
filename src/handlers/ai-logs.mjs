// AI call logs + feedback. Admin-only.

import { ok, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

const MAX_LIMIT = 200;

export async function listAiLogs(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const status = url.searchParams.get('status'); // ok | error | empty
  const conversationId = url.searchParams.get('conversation_id');
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), MAX_LIMIT);

  let q = 'SELECT * FROM ai_logs WHERE tenant_id = ?';
  const vals = [tenantId];
  if (status) { q += ' AND status = ?'; vals.push(status); }
  if (conversationId) { q += ' AND conversation_id = ?'; vals.push(conversationId); }
  if (since) { q += ' AND created_at >= ?'; vals.push(since); }
  if (until) { q += ' AND created_at <= ?'; vals.push(until); }
  q += ' ORDER BY created_at DESC LIMIT ?';
  vals.push(limit);

  const { results } = await env.DB.prepare(q).bind(...vals).all();

  // Aggregate feedback per log id
  const ids = (results || []).map((r) => r.id);
  let feedbackByLog = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const fbRes = await env.DB.prepare(
      `SELECT ai_log_id, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) up,
                         SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) down
         FROM ai_log_feedback
        WHERE ai_log_id IN (${placeholders})
     GROUP BY ai_log_id`
    ).bind(...ids).all();
    for (const r of (fbRes.results || [])) feedbackByLog[r.ai_log_id] = { up: r.up || 0, down: r.down || 0 };
  }

  const withFb = (results || []).map((r) => ({ ...r, feedback: feedbackByLog[r.id] || { up: 0, down: 0 } }));
  return ok({ success: true, logs: withFb }, corsHeaders);
}

export async function getAiLog(request, env, corsHeaders, id) {
  const row = await env.DB.prepare('SELECT * FROM ai_logs WHERE id = ?').bind(id).first();
  if (!row) return err('Log not found', 404, corsHeaders);
  const fb = await env.DB.prepare('SELECT * FROM ai_log_feedback WHERE ai_log_id = ? ORDER BY created_at DESC').bind(id).all();
  return ok({ success: true, log: row, feedback: fb.results || [] }, corsHeaders);
}

export async function deleteAiLog(request, env, corsHeaders, id) {
  await env.DB.prepare('DELETE FROM ai_logs WHERE id = ?').bind(id).run();
  return ok({ success: true }, corsHeaders);
}

export async function submitFeedback(request, env, corsHeaders, logId) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const rating = parseInt(body.rating, 10);
  // Phase 1: accept -2 for ⚠️ (critical) in addition to 1/-1.
  if (![1, -1, -2].includes(rating)) return err('rating must be 1, -1, or -2', 400, corsHeaders);
  // Require an identifiable staff; otherwise the ON CONFLICT unique key is NULL
  // and rows accumulate without upsert. Bearer-token callers must supply
  // `?staff_id=` explicitly, else fail.
  let staffId = request.__staff?.id || null;
  if (staffId == null) {
    const url = new URL(request.url);
    const explicit = parseInt(url.searchParams.get('staff_id') || '', 10);
    if (!Number.isFinite(explicit)) return err('staff_id required for feedback', 400, corsHeaders);
    staffId = explicit;
  }
  const note = body.note ? String(body.note).slice(0, 2000) : null;
  await env.DB.prepare(
    `INSERT INTO ai_log_feedback (ai_log_id, staff_id, rating, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(ai_log_id, staff_id) DO UPDATE SET rating = excluded.rating, note = excluded.note, created_at = datetime('now')`
  ).bind(logId, staffId, rating, note).run();
  return ok({ success: true }, corsHeaders);
}

export async function aiStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const [total24, total7d, errors24, avgLat, thumbs] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) n FROM ai_logs WHERE tenant_id = ? AND created_at >= datetime('now','-1 day')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM ai_logs WHERE tenant_id = ? AND created_at >= datetime('now','-7 day')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM ai_logs WHERE tenant_id = ? AND status = 'error' AND created_at >= datetime('now','-1 day')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT AVG(latency_ms) n FROM ai_logs WHERE tenant_id = ? AND status = 'ok' AND created_at >= datetime('now','-1 day')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) up,
                           SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) down
                      FROM ai_log_feedback`).first(),
  ]);
  return ok({
    success: true,
    stats: {
      calls_24h: total24?.n || 0,
      calls_7d: total7d?.n || 0,
      errors_24h: errors24?.n || 0,
      avg_latency_ms_24h: Math.round(avgLat?.n || 0),
      thumbs_up: thumbs?.up || 0,
      thumbs_down: thumbs?.down || 0,
    },
  }, corsHeaders);
}

// Internal helper — called from ai-chat-adapter + shadow.mjs.
// Returns the inserted row id (or null on failure). Callers who need the id
// — e.g. shadow mode, which links shadow_of → primary — await the return.
export async function recordAiCall(env, entry) {
  try {
    const r = await env.DB.prepare(
      `INSERT INTO ai_logs
        (tenant_id, conversation_id, message_id, provider, model, system_prompt, input, output,
         tokens_in, tokens_out, latency_ms, status, error_message, prompt_id,
         retrieval_trace, escalation_reason, is_shadow, shadow_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.tenant_id || 'tenant_default',
      entry.conversation_id || null,
      entry.message_id || null,
      entry.provider || 'unknown',
      entry.model || 'unknown',
      (entry.system_prompt || '').slice(0, 2048),
      entry.input || null,
      entry.output || null,
      entry.tokens_in ?? null,
      entry.tokens_out ?? null,
      entry.latency_ms ?? null,
      entry.status || 'ok',
      entry.error_message || null,
      entry.prompt_id ?? null,
      entry.retrieval_trace ?? null,
      entry.escalation_reason ?? null,
      entry.is_shadow ? 1 : 0,
      entry.shadow_of ?? null,
    ).run();
    return r?.meta?.last_row_id ?? null;
  } catch (e) {
    console.warn('[ai-logs] record failed:', e.message);
    return null;
  }
}

// Phase 1: Silent-failure view endpoints — read from the 3 views created in
// migration 018. Used by admin UI to surface problems without explicit feedback.
export async function listSilentFailures(request, env, corsHeaders) {
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'escalation'; // escalation | repeat | anger
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), MAX_LIMIT);
  const viewMap = {
    escalation: 'v_ai_silent_escalation',
    repeat: 'v_ai_repeat_question',
    anger: 'v_ai_anger_followup',
  };
  const viewName = viewMap[view];
  if (!viewName) return err('invalid view (escalation|repeat|anger)', 400, corsHeaders);
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM ${viewName} ORDER BY ai_created_at DESC LIMIT ?`
    ).bind(limit).all();
    return ok({ success: true, view, rows: results || [] }, corsHeaders);
  } catch (e) {
    return err(`view not ready (run migration 018): ${e.message}`, 500, corsHeaders);
  }
}
