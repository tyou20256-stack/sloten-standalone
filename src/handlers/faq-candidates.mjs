// FAQ candidates — pending Q&A extracted from real conversations, awaiting
// admin review. Admin approves (promotes to `faq`) or rejects.

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';
import { extractFaqCandidates, setLastExtractionTs } from '../extractor.mjs';

export async function listCandidates(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const { results } = await env.DB.prepare(
    `SELECT * FROM faq_candidates
      WHERE tenant_id = ? AND status = ?
   ORDER BY source_count DESC, last_seen_at DESC
      LIMIT ?`
  ).bind(tenantId, status, limit).all();
  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) n FROM faq_candidates WHERE tenant_id = ? GROUP BY status`
  ).bind(tenantId).all();
  const byStatus = { pending: 0, approved: 0, rejected: 0 };
  for (const r of (counts.results || [])) byStatus[r.status] = r.n;
  return ok({ success: true, candidates: results || [], counts: byStatus }, corsHeaders);
}

export async function updateCandidate(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const existing = await env.DB.prepare('SELECT * FROM faq_candidates WHERE id = ?').bind(id).first();
  if (!existing) return err('Not found', 404, corsHeaders);
  const updates = [];
  const vals = [];
  if (body.question !== undefined) { updates.push('question = ?'); vals.push(String(body.question).slice(0, 500)); }
  if (body.answer !== undefined) { updates.push('answer = ?'); vals.push(String(body.answer).slice(0, 2000)); }
  if (body.category !== undefined) { updates.push('category = ?'); vals.push(body.category || null); }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE faq_candidates SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM faq_candidates WHERE id = ?').bind(id).first();
  return ok({ success: true, candidate: row }, corsHeaders);
}

async function promoteOne(env, candidate, staffId) {
  const r = await env.DB.prepare(
    `INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active)
     VALUES (?, ?, ?, ?, 'ja', 'reviewed', ?, 1)`
  ).bind(
    candidate.tenant_id, candidate.question, candidate.answer,
    candidate.category || '一般', candidate.source_count || 0,
  ).run();
  const faqId = r.meta.last_row_id;
  await env.DB.prepare(
    `UPDATE faq_candidates SET status = 'approved', approved_faq_id = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(faqId, staffId, candidate.id).run();
  return faqId;
}

export async function approveCandidate(request, env, corsHeaders, id) {
  const candidate = await env.DB.prepare('SELECT * FROM faq_candidates WHERE id = ?').bind(id).first();
  if (!candidate) return err('Not found', 404, corsHeaders);
  if (candidate.status !== 'pending') return err(`Already ${candidate.status}`, 400, corsHeaders);
  // Allow optional in-body overrides (edit before approve)
  const { body } = await parseJson(request, corsHeaders);
  const final = {
    ...candidate,
    question: (body?.question ?? candidate.question).slice(0, 500),
    answer: (body?.answer ?? candidate.answer).slice(0, 2000),
    category: body?.category ?? candidate.category,
  };
  const staffId = request.__staff?.id || null;
  const faqId = await promoteOne(env, final, staffId);
  return ok({ success: true, faq_id: faqId }, corsHeaders);
}

export async function rejectCandidate(request, env, corsHeaders, id) {
  const existing = await env.DB.prepare('SELECT id, status FROM faq_candidates WHERE id = ?').bind(id).first();
  if (!existing) return err('Not found', 404, corsHeaders);
  if (existing.status !== 'pending') return err(`Already ${existing.status}`, 400, corsHeaders);
  const staffId = request.__staff?.id || null;
  await env.DB.prepare(
    `UPDATE faq_candidates SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(staffId, id).run();
  return ok({ success: true }, corsHeaders);
}

export async function bulkAction(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const action = body.action;
  if (!['approve', 'reject'].includes(action)) return err('action must be approve or reject', 400, corsHeaders);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => Number.isFinite(x) || /^\d+$/.test(String(x))).map(Number) : [];
  if (ids.length === 0) return err('ids required', 400, corsHeaders);
  const staffId = request.__staff?.id || null;
  let done = 0;
  for (const id of ids) {
    const c = await env.DB.prepare('SELECT * FROM faq_candidates WHERE id = ?').bind(id).first();
    if (!c || c.status !== 'pending') continue;
    if (action === 'approve') {
      await promoteOne(env, c, staffId);
    } else {
      await env.DB.prepare(
        `UPDATE faq_candidates SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(staffId, id).run();
    }
    done++;
  }
  return ok({ success: true, processed: done }, corsHeaders);
}

// Manual trigger — runs the extractor immediately and returns stats.
export async function runExtractionNow(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7', 10);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const stats = await extractFaqCandidates(env, { sinceIso: since });
  await setLastExtractionTs(env, Date.now());
  return ok({ success: true, stats }, corsHeaders);
}
