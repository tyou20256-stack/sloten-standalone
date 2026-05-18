// src/retrieval.mjs
// Hybrid retrieval: FTS5 BM25 + (optional) Vectorize dense + RRF fusion.
// See:
//   HANDOFF/ai-accuracy-discussion/01-ai-engineer-rag.md §A (BM25), §B (Vectorize), §C (Hybrid RRF)
//
// Strategies (in order of preference):
//   1. hybrid_rrf  — FTS5 + Vectorize, merged via Reciprocal Rank Fusion
//   2. fts5_chunks — BM25 over knowledge_chunks (finer grain than docs)
//   3. fts5        — BM25 over faq + knowledge_sources whole-doc
//   4. legacy      — priority ORDER BY, fallback when FTS missing
//
// Feature flags decide which is active:
//   retrieval.use_vectorize = '1'  → allow hybrid RRF
//   retrieval.use_chunks    = '1'  → prefer kb_chunks_fts over kb_fts

import { vectorizeQueryInternal } from './handlers/vectorize.mjs';

const FTS_QUERY_MAX_LEN = 200;

// FTS5 tokens: strip punctuation that would be interpreted as operators,
// lowercase ASCII, and limit length. Individual CJK bigrams handled by the
// `unicode61 remove_diacritics 2` tokenizer in migration 019.
function sanitizeFtsQuery(text) {
  if (!text) return '';
  // Strip FTS5 operator chars AND Japanese punctuation. Now that all three
  // FTS tables use the `trigram` tokenizer, a trailing 「？」「。」 etc. is
  // baked into the 3-char windows ("必要？" → 要？ ...), polluting the match
  // and dropping recall. The long-vowel mark 「ー」 is intentionally NOT
  // stripped — it is part of ordinary words (メニュー, カレー).
  const cleaned = String(text)
    .replace(/["'(){}\[\]\*\^:]/g, ' ')
    .replace(/[？！。、，．・…〜「」『』（）【】〈〉《》〔〕!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FTS_QUERY_MAX_LEN);
  if (!cleaned) return '';

  // Split on whitespace AND on script boundaries (Latin ↔ CJK ↔ Kana ↔
  // particles). Without this, "paypay入金方法" stays as one trigram-mismatched
  // 10-char token; with this it becomes ["paypay", "入金方法"] and trigram
  // OR-matching finds FAQ rows containing either term.
  //
  // Boundaries detected:
  //   - whitespace (already collapsed above, but split on it again here)
  //   - Latin↔CJK (e.g. "paypay入金" → "paypay 入金")
  //   - Common Japanese particles (の/を/に/が/は/で/へ) split as separators
  //     so "PayPayの入金方法" → "PayPay 入金方法"
  //   - 「と」「や」 are deliberately omitted: they appear inside many ordinary
  //     words (やり方, とき, etc) and over-splitting kills useful tokens.
  const PARTICLE_RE = /([のをにがはでへ])/g;
  const SCRIPT_BOUNDARY_RE = /(?<=[぀-ヿ㐀-鿿])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[぀-ヿ㐀-鿿])/g;
  const split = cleaned
    .replace(SCRIPT_BOUNDARY_RE, ' ')
    .replace(PARTICLE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');

  // Trigram tokenizer needs >= 3 char tokens to be useful — drop 1-2 char
  // fragments to avoid noise (single particles, single hiragana etc).
  const tokens = split.filter((t) => t.length >= 3);
  if (!tokens.length) return '';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

// Per-isolate cache for the 3 retrieval-feature probes. Each probe runs 2-3
// sequential D1 reads (sqlite_master + feature_flags + EXISTS). On every
// AI-bot message we previously executed all 8 of those reads before BM25 even
// started — ~80-200 ms of sequential D1 wait time, every reply (Perf audit
// 2026-05-13 H1). Probes are effectively static at the isolate level: a
// schema change (rare) plus an admin feature-flag toggle (also rare) both
// involve a deploy/cron pause. 60 s TTL bounds staleness for the toggle case.
const PROBE_CACHE = { hasFts: null, hasChunks: null, hasVectorize: null };
const PROBE_TTL_MS = 60_000;
function cacheFresh(entry) {
  return entry && entry.expires > Date.now();
}
function cachePut(key, value) {
  PROBE_CACHE[key] = { value, expires: Date.now() + PROBE_TTL_MS };
}
function cacheGet(key) {
  return cacheFresh(PROBE_CACHE[key]) ? PROBE_CACHE[key].value : undefined;
}

async function ftsAvailable(env) {
  const cached = cacheGet('hasFts');
  if (cached !== undefined) return cached;
  let value = false;
  try {
    const r = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='faq_fts'`,
    ).first();
    value = !!r;
  } catch { value = false; }
  cachePut('hasFts', value);
  return value;
}

// Phase 2 B: prefer chunk-level retrieval when chunks have been populated
// (scripts/chunk-knowledge.mjs --apply). Falls back to whole-document kb_fts
// when the chunks table is empty.
async function chunksAvailable(env) {
  const cached = cacheGet('hasChunks');
  if (cached !== undefined) return cached;
  let value = false;
  try {
    const flag = await env.DB.prepare(
      `SELECT value FROM feature_flags WHERE key = 'retrieval.use_chunks'`,
    ).first();
    if (flag?.value === '1') {
      const tbl = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='kb_chunks_fts'`,
      ).first();
      if (tbl) {
        // EXISTS (LIMIT 1) instead of COUNT(*) — same boolean answer, but
        // scan terminates on the first row rather than counting all rows.
        const has = await env.DB.prepare(
          `SELECT 1 FROM knowledge_chunks LIMIT 1`,
        ).first();
        value = !!has;
      }
    }
  } catch { value = false; }
  cachePut('hasChunks', value);
  return value;
}

// Phase 2b C: hybrid with Vectorize dense retrieval when flag is on.
async function vectorizeAvailable(env) {
  if (!env.VECTORIZE || !env.AI) return false;
  const cached = cacheGet('hasVectorize');
  if (cached !== undefined) return cached;
  let value = false;
  try {
    const flag = await env.DB.prepare(
      `SELECT value FROM feature_flags WHERE key = 'retrieval.use_vectorize'`,
    ).first();
    if (flag?.value === '1') {
      // Hybrid is viable if EITHER the KB-chunk index OR the FAQ index has
      // vectors. FAQ dense alone meaningfully lifts recall (the dominant
      // grounding source is FAQ), so don't gate the whole hybrid path on
      // kb_chunks being populated.
      const state = await env.DB.prepare(
        `SELECT COALESCE(SUM(item_count), 0) AS n FROM vectorize_index_state
          WHERE kind IN ('kb_chunks', 'faq')`,
      ).first();
      value = (state?.n || 0) > 0;
    }
  } catch { value = false; }
  cachePut('hasVectorize', value);
  return value;
}

// Reciprocal Rank Fusion — merges 2+ ranked lists into one by summing
// 1/(k + rank) across sources. k=60 is standard. Output is stable ranking
// over items present in any input list.
function rrfFuse(rankedLists, k = 60) {
  const scores = new Map();
  const meta = new Map();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const key = item.key;
      scores.set(key, (scores.get(key) || 0) + 1 / (k + i + 1));
      if (!meta.has(key)) meta.set(key, item);
    }
  }
  return [...scores.entries()]
    .map(([key, score]) => ({ ...meta.get(key), rrf_score: score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}

// Fetch knowledge_chunks by ids in bulk for hybrid path.
async function fetchChunksById(env, ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, heading_path AS title, content FROM knowledge_chunks WHERE id IN (${placeholders})`,
  ).bind(...ids).all();
  // Preserve input order
  const byId = new Map((results || []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Fetch FAQ rows by ids in bulk, tenant-scoped, preserving fused rank order.
async function fetchFaqById(env, tenantId, ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, question, answer, category FROM faq
      WHERE id IN (${placeholders}) AND tenant_id = ? AND is_active = 1`,
  ).bind(...ids, tenantId).all();
  const byId = new Map((results || []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Legacy retrieval — priority-based top-N. Used as fallback.
export async function retrievalLegacy(env, tenantId, faqLimit, kbLimit) {
  const [faq, kb] = await Promise.all([
    env.DB.prepare(
      `SELECT id, question, answer, category
         FROM faq WHERE tenant_id = ? AND is_active = 1
         ORDER BY priority DESC, usage_count DESC LIMIT ?`,
    ).bind(tenantId, faqLimit).all(),
    // Tenant-scoped KB lookup (migration 026 added knowledge_sources.tenant_id).
    // Without this filter, a tenant-A bot reply could be grounded against
    // tenant-B's KB content (CWE-639 RAG-side; 2026-05-13 second-pass audit).
    env.DB.prepare(
      `SELECT id, title, content
         FROM knowledge_sources WHERE tenant_id = ? AND is_active = 1
         ORDER BY priority DESC, id DESC LIMIT ?`,
    ).bind(tenantId, kbLimit).all(),
  ]);
  return {
    faqRows: faq.results || [],
    kbRows: kb.results || [],
    strategy: 'legacy',
  };
}

// FTS5 BM25 retrieval — top-K relevance-ranked by user query. Negative
// bm25() score = more relevant.
async function retrievalFts5(env, tenantId, userQuery, faqLimit, kbLimit, useChunks = false) {
  const q = sanitizeFtsQuery(userQuery);
  if (!q) return null;

  try {
    // Tenant-scoped KB queries (CWE-639 fix, 2026-05-13 second-pass audit).
    // Both kb_fts and kb_chunks_fts join back to knowledge_sources, which
    // since migration 026 carries tenant_id. For kb_chunks_fts the chunk row
    // links to its source via knowledge_chunks.source_id → knowledge_sources.
    const kbQuery = useChunks
      ? env.DB.prepare(
          `SELECT c.id, c.heading_path AS title, c.content, bm25(kb_chunks_fts) AS score
             FROM kb_chunks_fts
             JOIN knowledge_chunks c ON c.id = kb_chunks_fts.rowid
             JOIN knowledge_sources ks ON ks.id = c.source_id
            WHERE kb_chunks_fts MATCH ?
              AND ks.tenant_id = ?
              AND ks.is_active = 1
            ORDER BY score LIMIT ?`,
        ).bind(q, tenantId, kbLimit)
      : env.DB.prepare(
          `SELECT k.id, k.title, k.content, bm25(kb_fts) AS score
             FROM kb_fts
             JOIN knowledge_sources k ON k.id = kb_fts.rowid
            WHERE kb_fts MATCH ?
              AND k.tenant_id = ?
              AND k.is_active = 1
            ORDER BY score LIMIT ?`,
        ).bind(q, tenantId, kbLimit);

    const [faq, kb] = await Promise.all([
      env.DB.prepare(
        `SELECT f.id, f.question, f.answer, f.category, bm25(faq_fts) AS score
           FROM faq_fts
           JOIN faq f ON f.id = faq_fts.rowid
          WHERE faq_fts MATCH ?
            AND f.tenant_id = ?
            AND f.is_active = 1
          ORDER BY score LIMIT ?`,
      ).bind(q, tenantId, faqLimit).all(),
      kbQuery.all(),
    ]);
    return {
      faqRows: faq.results || [],
      kbRows: kb.results || [],
      strategy: useChunks ? 'fts5_chunks' : 'fts5',
      query: q,
    };
  } catch (e) {
    // malformed query — e.g. single control char survived sanitize; fall back
    console.warn('[retrieval:fts5]', e?.message);
    return null;
  }
}

// Phase 2b: Hybrid retrieval — FTS5 BM25 + Vectorize dense, fused via RRF.
// Works on knowledge_chunks (kb_chunks_fts + Vectorize index). FAQ still uses
// FTS5-only (smaller corpus, no embedding investment needed yet).
async function retrievalHybrid(env, tenantId, userQuery, faqLimit, kbLimit) {
  const q = sanitizeFtsQuery(userQuery);
  if (!q) return null;
  try {
    // Dense query — tenantId required (fail-closed cross-tenant guard).
    // The Vectorize ID format `${tenant_id}:kb_${id}` already namespaces vectors
    // per tenant, AND the metadata index includes tenant_id — so the filter
    // here mirrors the BM25-side tenant check below for defense in depth.
    const denseMatches = await vectorizeQueryInternal(env, userQuery, {
      tenantId,
      topK: kbLimit * 2,
      filter: { kind: 'kb_chunk', tenant_id: tenantId },
    });
    // BM25 on chunks — tenant-scoped via knowledge_sources join (CWE-639 fix,
    // 2026-05-13 second-pass audit).
    const { results: chunkBm25 } = await env.DB.prepare(
      `SELECT c.id, c.heading_path AS title, c.content, bm25(kb_chunks_fts) AS score
         FROM kb_chunks_fts
         JOIN knowledge_chunks c ON c.id = kb_chunks_fts.rowid
         JOIN knowledge_sources ks ON ks.id = c.source_id
        WHERE kb_chunks_fts MATCH ?
          AND ks.tenant_id = ?
          AND ks.is_active = 1
        ORDER BY score LIMIT ?`,
    ).bind(q, tenantId, kbLimit * 2).all();
    // FAQ — hybrid BM25 + dense, RRF-fused (2026-05-18). FAQ was previously
    // FTS5-only; trigram can't match when the user's wording differs from the
    // stored FAQ ("出金方法は" vs FAQ "出金にはどれくらい…") or when the query
    // reduces to <3-char tokens ("入金"/"出金"). Dense closes both gaps. The
    // dense list also rescues the case where BM25 returns nothing at all
    // (previously → hybrid_fts_miss → generic priority dump).
    const faqBm25Limit = Math.max(faqLimit * 2, faqLimit);
    const [{ results: faqBm25 }, faqDenseRaw] = await Promise.all([
      env.DB.prepare(
        `SELECT f.id, f.question, f.answer, f.category, bm25(faq_fts) AS score
           FROM faq_fts
           JOIN faq f ON f.id = faq_fts.rowid
          WHERE faq_fts MATCH ?
            AND f.tenant_id = ?
            AND f.is_active = 1
          ORDER BY score LIMIT ?`,
      ).bind(q, tenantId, faqBm25Limit).all(),
      vectorizeQueryInternal(env, userQuery, {
        tenantId,
        topK: faqBm25Limit,
        filter: { kind: 'faq', tenant_id: tenantId },
      }),
    ]);
    const faqBm25Ranked = (faqBm25 || []).map((r, i) => ({ key: r.id, rank: i, source: 'bm25' }));
    const faqDenseRanked = (faqDenseRaw || [])
      .map((m, i) => {
        const idStr = String(m.id);
        // ID format: `${tenant}:faqa_${faqId}` (faqa = active FAQ; distinct
        // from the faq_candidates `:faq_` namespace).
        const after = idStr.includes(':faqa_')
          ? idStr.split(':faqa_').pop()
          : idStr.replace(/^faqa_/, '');
        return { key: parseInt(after, 10), rank: i, source: 'dense', vec_score: m.score };
      })
      .filter((m) => Number.isFinite(m.key));
    const faqFused = rrfFuse([faqBm25Ranked, faqDenseRanked]).slice(0, faqLimit);
    const faqFusedIds = faqFused.map((f) => f.key);
    const faqRes = await fetchFaqById(env, tenantId, faqFusedIds);

    // RRF fusion on KB chunks.
    // Vectorize ID format: `${tenant_id}:kb_${dbId}` (post tenant scoping
    // 2026-05-09). Pre-scoping format was just `kb_${dbId}` — split on
    // ':kb_' picks dbId in both, then a defensive fallback for legacy.
    const bm25Ranked = (chunkBm25 || []).map((r, i) => ({ key: r.id, rank: i, source: 'bm25' }));
    const denseRanked = (denseMatches || [])
      .map((m, i) => {
        const idStr = String(m.id);
        // Try tenant-scoped format first, fall back to legacy `kb_N`.
        const after = idStr.includes(':kb_') ? idStr.split(':kb_').pop() : idStr.replace(/^kb_/, '');
        return { key: parseInt(after, 10), rank: i, source: 'dense', vec_score: m.score };
      })
      .filter((m) => Number.isFinite(m.key));
    const fused = rrfFuse([bm25Ranked, denseRanked]).slice(0, kbLimit);
    const fusedIds = fused.map((f) => f.key);
    const kbRows = await fetchChunksById(env, fusedIds);

    return {
      faqRows: faqRes || [],
      kbRows,
      strategy: 'hybrid_rrf',
      query: q,
      trace: {
        strategy: 'hybrid_rrf',
        faq_ids: faqFusedIds,
        // FAQ is now RRF-fused (bm25 + dense), so per-row bm25 scores no
        // longer reflect final rank. Surface the component counts instead so
        // Golden Set eval can tell "BM25 missed, dense rescued" from "both
        // missed".
        faq_bm25_count: faqBm25Ranked.length,
        faq_dense_count: faqDenseRanked.length,
        faq_top_rrf_score: faqFused[0]?.rrf_score || 0,
        kb_ids: fusedIds,
        kb_bm25_scores: (chunkBm25 || []).map((r) => ({ id: r.id, score: r.score })),
        query: q,
        sanitized_query: q,
        bm25_count: bm25Ranked.length,
        dense_count: denseRanked.length,
        top_rrf_score: fused[0]?.rrf_score || 0,
      },
    };
  } catch (e) {
    console.warn('[retrieval:hybrid]', e.message);
    return null;
  }
}

/**
 * Top-level retrieval. Uses FTS5 if available and query has content;
 * falls back to priority-based when FTS misses or on any error.
 * Returns { faqRows, kbRows, strategy: 'fts5'|'legacy'|'hybrid', trace }.
 *
 * trace: { faq_ids: [...], kb_ids: [...], strategy: '...' } — written to
 * ai_logs.retrieval_trace JSON for later analysis (§ AI Engineer finding D).
 */
export async function retrieveContext(env, tenantId, userQuery, opts = {}) {
  const faqLimit = opts.faqLimit || 10;
  const kbLimit = opts.kbLimit || 6;

  // Resolve all three probes once and reuse — eliminates the duplicate
  // chunksAvailable() invocations the old code path made (Perf audit H1).
  // Each call now hits the per-isolate cache after the first run.
  const [hasVectorize, hasChunks, hasFts] = await Promise.all([
    vectorizeAvailable(env),
    chunksAvailable(env),
    ftsAvailable(env),
  ]);

  // Phase 2b: Hybrid RRF path — only when Vectorize + chunks are both active.
  if (hasVectorize && hasChunks) {
    const hybrid = await retrievalHybrid(env, tenantId, userQuery, faqLimit, kbLimit);
    if (hybrid) return hybrid;
    // fall through to FTS-only on hybrid failure
  }

  if (hasFts) {
    const useChunks = hasChunks;
    const fts = await retrievalFts5(env, tenantId, userQuery, faqLimit, kbLimit, useChunks);
    // If FTS returned at least one result we trust it. Otherwise blend with
    // priority fallback so the LLM still has general-purpose context.
    if (fts && (fts.faqRows.length > 0 || fts.kbRows.length > 0)) {
      return {
        ...fts,
        trace: {
          strategy: 'fts5',
          faq_ids: fts.faqRows.map((r) => r.id),
          faq_scores: fts.faqRows.map((r) => ({ id: r.id, score: r.score })),
          kb_ids: fts.kbRows.map((r) => r.id),
          kb_scores: fts.kbRows.map((r) => ({ id: r.id, score: r.score })),
          query: fts.query,
          sanitized_query: fts.query,
        },
      };
    }
    // FTS empty — blend: keep legacy priority top-K so the LLM has something
    // rather than no grounding at all.
    const legacy = await retrievalLegacy(env, tenantId, faqLimit, kbLimit);
    return {
      ...legacy,
      strategy: 'hybrid_fts_miss',
      trace: {
        strategy: 'hybrid_fts_miss',
        faq_ids: legacy.faqRows.map((r) => r.id),
        kb_ids: legacy.kbRows.map((r) => r.id),
      },
    };
  }

  const legacy = await retrievalLegacy(env, tenantId, faqLimit, kbLimit);
  return {
    ...legacy,
    trace: {
      strategy: 'legacy',
      faq_ids: legacy.faqRows.map((r) => r.id),
      kb_ids: legacy.kbRows.map((r) => r.id),
    },
  };
}
