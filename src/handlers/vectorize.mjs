// src/handlers/vectorize.mjs
// Workers AI + Vectorize integration (HANDOFF/ai-accuracy-discussion/01-ai-engineer-rag.md §B, §C)
//
// Phase 2b provides:
//   POST /api/admin/vectorize/reindex  — (re)embed knowledge_chunks + upsert
//   POST /api/admin/vectorize/query    — dev/test endpoint for BM25 vs vector compare
//   GET  /api/admin/vectorize/state    — index status (last reindex, count, dim)
//
// All endpoints are admin-only (index.mjs wires via requireAdminRole).
//
// Tenant isolation (added 2026-05-09 per architecture audit):
//   Vectorize is a single global index — without tenant scoping, KB content
//   from one tenant leaks into another's RAG retrieval. We namespace IDs as
//   `${tenant_id}:kb_${id}` and embed `tenant_id` in metadata, then apply
//   `filter: { tenant_id }` on every query. Queries from staff/widget always
//   provide tenant_id; query without it is rejected.

import { ok, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

const EMBED_MODEL = '@cf/baai/bge-m3';
const EMBED_DIM = 1024;
const BATCH_SIZE = 50;  // Workers AI tolerates up to 100/request, 50 keeps memory bounded.

async function embed(env, texts) {
  if (!env.AI) throw new Error('Workers AI binding (env.AI) not configured');
  if (!Array.isArray(texts) || texts.length === 0) return [];
  // env.AI.run returns { data: number[][] } for embedding models.
  const resp = await env.AI.run(EMBED_MODEL, { text: texts });
  const out = resp?.data || [];
  if (out.length !== texts.length) {
    throw new Error(`embed shape mismatch: expected ${texts.length}, got ${out.length}`);
  }
  return out;
}

// POST /api/admin/vectorize/reindex
//   body: { kind: 'kb_chunks' | 'faq_candidates', force?: boolean }
export async function vectorizeReindex(request, env, corsHeaders) {
  if (!env.VECTORIZE) return err('Vectorize binding not configured', 500, corsHeaders);
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const kind = body.kind || 'kb_chunks';
  const force = !!body.force;

  // Reindex is staff-scoped: pull only this tenant's content. Multi-tenant
  // production must reindex per tenant or under a super-admin loop.
  const tenantId = resolveTenantId(request, env);

  let rows = [];
  if (kind === 'kb_chunks') {
    // 2026-05-10: migration 026 added knowledge_sources.tenant_id, so we now
    // filter chunks via JOIN by the source's actual tenant_id. This unblocks
    // multi-tenant: tenant A reindexing no longer rewrites tenant B vectors.
    const { results } = await env.DB.prepare(
      `SELECT kc.id, kc.content, kc.heading_path, kc.content_hash, ks.tenant_id
         FROM knowledge_chunks kc
         INNER JOIN knowledge_sources ks ON kc.source_id = ks.id
        WHERE kc.content IS NOT NULL AND length(kc.content) > 50
          AND ks.tenant_id = ?`,
    ).bind(tenantId).all();
    rows = (results || []).map((r) => ({
      id: `${r.tenant_id}:kb_${r.id}`,
      text: r.content,
      metadata: {
        kind: 'kb_chunk',
        tenant_id: r.tenant_id,
        source_id: r.id,
        heading: r.heading_path || '',
      },
      hashColumn: 'content_hash',
      dbId: r.id,
    }));
  } else if (kind === 'faq_candidates') {
    const { results } = await env.DB.prepare(
      `SELECT id, question, embedding_hash FROM faq_candidates
        WHERE question IS NOT NULL AND length(question) > 4 AND status = 'pending'
          AND tenant_id = ?`,
    ).bind(tenantId).all();
    rows = (results || []).map((r) => ({
      id: `${tenantId}:faq_${r.id}`,
      text: r.question,
      metadata: {
        kind: 'faq_candidate',
        tenant_id: tenantId,
        candidate_id: r.id,
      },
      hashColumn: 'embedding_hash',
      dbId: r.id,
    }));
  } else if (kind === 'faq') {
    // Active FAQ semantic index (2026-05-18). Trigram FTS5 can't match a
    // question whose wording differs from the stored FAQ (e.g. "出金方法は"
    // vs FAQ "出金にはどれくらい…") — dense retrieval closes that gap.
    // Embed question + answer so paraphrases on either side still match.
    // ID prefix is `faqa_` (NOT `faq_`) to avoid colliding with the
    // faq_candidates namespace (`${tenant}:faq_${id}`), whose autoincrement
    // ids overlap numerically with the faq table's.
    const { results } = await env.DB.prepare(
      `SELECT id, question, answer FROM faq
        WHERE is_active = 1 AND tenant_id = ?`,
    ).bind(tenantId).all();
    rows = (results || []).map((r) => ({
      id: `${tenantId}:faqa_${r.id}`,
      text: `${r.question}\n${r.answer}`,
      metadata: {
        kind: 'faq',
        tenant_id: tenantId,
        faq_id: r.id,
      },
      dbId: r.id,
    }));
  } else {
    return err('kind must be kb_chunks, faq_candidates, or faq', 400, corsHeaders);
  }

  if (rows.length === 0) {
    return ok({ success: true, kind, embedded: 0, note: 'nothing to embed' }, corsHeaders);
  }

  // Clean up legacy non-namespaced IDs from the pre-2026-05-09 index format.
  // Best-effort: failures don't block reindex (Vectorize tolerates orphans).
  // After tenant scoping, queries filter by tenant_id metadata which excludes
  // legacy vectors anyway, so leftover orphans degrade only storage cost.
  try {
    const legacyIds = rows.map((r) => {
      if (kind === 'kb_chunks') return `kb_${r.dbId}`;
      if (kind === 'faq') return `faqa_${r.dbId}`;
      return `faq_${r.dbId}`;
    });
    if (legacyIds.length > 0) {
      await env.VECTORIZE.deleteByIds(legacyIds);
    }
  } catch (e) {
    console.warn('[vectorize:reindex] legacy cleanup failed (non-blocking):', e?.message);
  }

  // Batched embedding + upsert
  let totalEmbedded = 0;
  let totalTokens = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await embed(env, batch.map((r) => r.text.slice(0, 2000)));
      const upsertPayload = batch.map((r, idx) => ({
        id: r.id,
        values: vectors[idx],
        metadata: r.metadata,
      }));
      await env.VECTORIZE.upsert(upsertPayload);
      totalEmbedded += batch.length;
      totalTokens += batch.reduce((s, r) => s + Math.ceil(r.text.length * 0.65), 0);
    } catch (e) {
      errors.push({ batch_start: i, error: e.message });
      console.warn('[vectorize:reindex]', e.message);
    }
  }

  // Record state
  await env.DB.prepare(
    `UPDATE vectorize_index_state
        SET last_reindex_at = datetime('now'),
            item_count = ?,
            embedding_model = ?,
            embedding_dim = ?,
            notes = ?
      WHERE kind = ?`,
  ).bind(
    totalEmbedded,
    EMBED_MODEL,
    EMBED_DIM,
    errors.length ? `partial: ${errors.length} batch errors` : 'ok',
    kind,
  ).run();

  return ok({
    success: true,
    kind,
    embedded: totalEmbedded,
    total: rows.length,
    tokens_approx: totalTokens,
    errors: errors.length ? errors : undefined,
    model: EMBED_MODEL,
  }, corsHeaders);
}

// POST /api/admin/vectorize/query
//   body: { text: string, top_k?: number, kind?: 'kb_chunk' | 'faq_candidate' }
export async function vectorizeQuery(request, env, corsHeaders) {
  if (!env.VECTORIZE || !env.AI) return err('AI/Vectorize bindings not configured', 500, corsHeaders);
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const text = String(body.text || '').trim();
  if (!text) return err('text required', 400, corsHeaders);
  const topK = Math.min(body.top_k || 8, 30);
  // Tenant-scoped filter — staff session enforces own tenant_id; super-admin
  // (Bearer + ?tenant_id=) can target a specific tenant. Without this filter
  // the dev/test endpoint would reveal another tenant's KB embeddings.
  const tenantId = resolveTenantId(request, env);
  const filter = { tenant_id: tenantId };
  if (body.kind) filter.kind = body.kind;

  try {
    const [embeddings] = await embed(env, [text]);
    const result = await env.VECTORIZE.query(embeddings, { topK, filter, returnMetadata: 'all' });
    return ok({
      success: true,
      matches: (result?.matches || []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: m.metadata,
      })),
    }, corsHeaders);
  } catch (e) {
    console.error('[vectorize:query]', e?.message);
    return err('vectorize query failed', 500, corsHeaders);
  }
}

// GET /api/admin/vectorize/state
export async function vectorizeState(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(
    `SELECT kind, last_reindex_at, item_count, embedding_model, embedding_dim, notes
       FROM vectorize_index_state`,
  ).all();
  const flags = await env.DB.prepare(
    `SELECT key, value FROM feature_flags
       WHERE key IN ('retrieval.use_vectorize', 'retrieval.use_chunks')`,
  ).all();
  const flagMap = {};
  for (const r of (flags.results || [])) flagMap[r.key] = r.value;
  return ok({
    success: true,
    ai_binding: !!env.AI,
    vectorize_binding: !!env.VECTORIZE,
    state: results || [],
    flags: flagMap,
  }, corsHeaders);
}

// POST /api/admin/vectorize/flags — toggle retrieval strategy flags.
export async function setVectorizeFlags(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const allowed = ['retrieval.use_vectorize', 'retrieval.use_chunks'];
  for (const k of Object.keys(body || {})) {
    if (!allowed.includes(k)) continue;
    const val = body[k] === true || body[k] === '1' ? '1' : '0';
    await env.DB.prepare(
      `INSERT INTO feature_flags (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(k, val).run();
  }
  return ok({ success: true }, corsHeaders);
}

// Internal helper — called from retrieval.mjs when hybrid mode is on.
// Returns an array of { id, score, metadata } from Vectorize.
//
// `opts.tenantId` is REQUIRED — fail-closed to prevent cross-tenant retrieval.
// Caller (retrieval.mjs) must pass the resolved tenant_id from the conversation
// or the staff session.
export async function vectorizeQueryInternal(env, text, opts = {}) {
  if (!env.VECTORIZE || !env.AI || !text) return null;
  if (!opts.tenantId) {
    console.warn('[vectorize:internal] tenantId required, refusing query');
    return null;
  }
  try {
    const [vec] = await embed(env, [String(text).slice(0, 2000)]);
    const filter = { tenant_id: opts.tenantId, ...(opts.filter || {}) };
    const result = await env.VECTORIZE.query(vec, {
      topK: opts.topK || 8,
      filter,
      returnMetadata: 'all',
    });
    return result?.matches || [];
  } catch (e) {
    console.warn('[vectorize:internal]', e.message);
    return null;
  }
}
