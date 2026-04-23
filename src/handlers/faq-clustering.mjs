// src/handlers/faq-clustering.mjs
// FAQ Candidates Silver 層 (HANDOFF/ai-accuracy-discussion/04-data-engineer.md §3)
//
// Pipeline:
//   1. Fetch all `pending` faq_candidates
//   2. Embed each via Workers AI (@cf/baai/bge-m3)
//   3. Greedy clustering: cosine similarity ≥ CLUSTER_THRESHOLD (default 0.85)
//      groups semantically-equivalent questions
//   4. Frequency threshold: only clusters with size >= FREQ_THRESHOLD (default 3)
//      are "promoted" — reviewer sees cluster rep + size + example conversations
//      rather than 606 individual variants
//
// Expected effect per Data Engineer agent:
//   606 candidates → ~80 clusters, adoption rate 3% → 40%+

import { ok, err } from '../json.mjs';

const EMBED_MODEL = '@cf/baai/bge-m3';
const BATCH_SIZE = 50;
const CLUSTER_THRESHOLD = 0.85;
const FREQ_THRESHOLD = 3;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

async function embedBatch(env, texts) {
  if (!env.AI) throw new Error('Workers AI (env.AI) not configured');
  const resp = await env.AI.run(EMBED_MODEL, { text: texts });
  return resp?.data || [];
}

// Greedy clustering: for each new item, either join the closest existing
// cluster (if similarity ≥ threshold) or start a new cluster. O(n² / 2).
function greedyCluster(vectors, threshold) {
  const clusters = []; // each: { rep_idx, members: [idx], centroid: number[] }
  for (let i = 0; i < vectors.length; i++) {
    let bestSim = -1;
    let bestCluster = -1;
    for (let c = 0; c < clusters.length; c++) {
      const sim = cosine(vectors[i], clusters[c].centroid);
      if (sim > bestSim) { bestSim = sim; bestCluster = c; }
    }
    if (bestCluster >= 0 && bestSim >= threshold) {
      const cl = clusters[bestCluster];
      cl.members.push(i);
      // Incremental mean
      for (let d = 0; d < cl.centroid.length; d++) {
        cl.centroid[d] = (cl.centroid[d] * (cl.members.length - 1) + vectors[i][d]) / cl.members.length;
      }
    } else {
      clusters.push({ rep_idx: i, members: [i], centroid: [...vectors[i]] });
    }
  }
  return clusters;
}

function avgInternalSim(vectors, member_indices) {
  if (member_indices.length < 2) return 1.0;
  let sum = 0, pairs = 0;
  for (let i = 0; i < member_indices.length; i++) {
    for (let j = i + 1; j < member_indices.length; j++) {
      sum += cosine(vectors[member_indices[i]], vectors[member_indices[j]]);
      pairs++;
    }
  }
  return sum / pairs;
}

// POST /api/admin/faq-candidates/cluster
//   body: { threshold?: 0.85, freq?: 3, dry_run?: false }
export async function clusterFaqCandidates(request, env, corsHeaders) {
  if (!env.AI) return err('Workers AI binding required', 500, corsHeaders);
  let body = {};
  try { body = await request.clone().json(); } catch {}
  const threshold = typeof body.threshold === 'number' ? body.threshold : CLUSTER_THRESHOLD;
  const freq = typeof body.freq === 'number' ? body.freq : FREQ_THRESHOLD;
  const dryRun = !!body.dry_run;

  // Include both pending AND rejected — rejected ones are the "signal" per
  // HANDOFF/ai-accuracy-discussion/05-feedback-synthesizer.md §5. Low-quality
  // individual candidates still indicate real demand when they cluster.
  const includeRejected = body.include_rejected !== false;
  const statusClause = includeRejected
    ? `status IN ('pending', 'rejected')`
    : `status = 'pending'`;
  const { results } = await env.DB.prepare(
    `SELECT id, question FROM faq_candidates
      WHERE ${statusClause} AND question IS NOT NULL AND length(question) > 4
      ORDER BY id ASC`,
  ).all();
  const candidates = results || [];
  if (candidates.length === 0) {
    return ok({ success: true, candidates: 0, clusters: 0, note: 'no pending candidates' }, corsHeaders);
  }

  // Embed in batches
  const texts = candidates.map((c) => c.question);
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => String(t).slice(0, 500));
    try {
      const v = await embedBatch(env, batch);
      vectors.push(...v);
    } catch (e) {
      return err(`embedding failed at batch ${i}: ${e.message}`, 500, corsHeaders);
    }
  }

  const clusters = greedyCluster(vectors, threshold);
  const promotedCount = clusters.filter((c) => c.members.length >= freq).length;

  if (dryRun) {
    const top = clusters
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 30)
      .map((c) => ({
        rep: candidates[c.rep_idx].question,
        size: c.members.length,
        promoted: c.members.length >= freq,
        avg_sim: avgInternalSim(vectors, c.members).toFixed(3),
        sample_members: c.members.slice(0, 5).map((i) => candidates[i].question),
      }));
    return ok({
      success: true,
      dry_run: true,
      candidates: candidates.length,
      clusters: clusters.length,
      promoted: promotedCount,
      threshold,
      freq_threshold: freq,
      top_clusters: top,
    }, corsHeaders);
  }

  // Persist: upsert faq_candidate_clusters + tag candidates
  // 1. Clear existing cluster assignments (idempotent re-cluster)
  await env.DB.prepare(
    `UPDATE faq_candidates SET cluster_id = NULL, cluster_rank = NULL
      WHERE ${statusClause}`,
  ).run();
  await env.DB.prepare(`DELETE FROM faq_candidate_clusters`).run();

  // 2. Insert cluster rows + tag members
  let persisted = 0;
  for (const c of clusters) {
    const repCandId = candidates[c.rep_idx].id;
    const avgSim = avgInternalSim(vectors, c.members);
    const promoted = c.members.length >= freq ? 1 : 0;
    const ins = await env.DB.prepare(
      `INSERT INTO faq_candidate_clusters
         (tenant_id, representative_id, size, avg_similarity, promoted)
       VALUES ('tenant_default', ?, ?, ?, ?)`,
    ).bind(repCandId, c.members.length, avgSim, promoted).run();
    const clusterId = ins?.meta?.last_row_id;
    // Tag members
    for (let rank = 0; rank < c.members.length; rank++) {
      const idx = c.members[rank];
      const candId = candidates[idx].id;
      const isRep = idx === c.rep_idx ? 0 : rank + 1;
      await env.DB.prepare(
        `UPDATE faq_candidates SET cluster_id = ?, cluster_rank = ? WHERE id = ?`,
      ).bind(clusterId, idx === c.rep_idx ? 0 : rank + 1, candId).run();
      persisted++;
    }
  }

  return ok({
    success: true,
    candidates: candidates.length,
    clusters: clusters.length,
    promoted: promotedCount,
    rows_updated: persisted,
    threshold,
    freq_threshold: freq,
  }, corsHeaders);
}

// GET /api/admin/faq-candidates/clusters?promoted=1&limit=50
export async function listClusters(request, env, corsHeaders) {
  const url = new URL(request.url);
  const promoted = url.searchParams.get('promoted');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
  let q = `SELECT c.id, c.representative_id, c.size, c.avg_similarity, c.promoted, c.created_at,
                  f.question AS rep_question, f.category AS rep_category
             FROM faq_candidate_clusters c
             JOIN faq_candidates f ON f.id = c.representative_id`;
  const vals = [];
  if (promoted === '1') q += ' WHERE c.promoted = 1';
  q += ' ORDER BY c.size DESC LIMIT ?';
  vals.push(limit);
  const { results } = await env.DB.prepare(q).bind(...vals).all();
  return ok({ success: true, clusters: results || [] }, corsHeaders);
}

// GET /api/admin/faq-candidates/clusters/:id/members
export async function clusterMembers(request, env, corsHeaders, clusterId) {
  const { results } = await env.DB.prepare(
    `SELECT id, question, status, cluster_rank, created_at
       FROM faq_candidates WHERE cluster_id = ? ORDER BY cluster_rank ASC`,
  ).bind(clusterId).all();
  return ok({ success: true, members: results || [] }, corsHeaders);
}
