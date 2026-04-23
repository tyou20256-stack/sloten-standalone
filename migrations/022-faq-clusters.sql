-- @idempotent — 022-faq-clusters.sql
-- FAQ Candidates Silver 層 (HANDOFF/ai-accuracy-discussion/04-data-engineer.md §3)
-- 606 candidates を embedding cluster + 頻度閾値で ~80 cluster に圧縮し、
-- reviewer に「cluster 代表 + 出現回数」の粒度で提示する。

-- Add cluster columns to faq_candidates
ALTER TABLE faq_candidates ADD COLUMN cluster_id INTEGER;
ALTER TABLE faq_candidates ADD COLUMN cluster_rank INTEGER;  -- 0 = representative, 1+ = member
ALTER TABLE faq_candidates ADD COLUMN embedding_hash TEXT;   -- cache key for embedding reuse

CREATE INDEX IF NOT EXISTS idx_faq_cand_cluster ON faq_candidates(cluster_id, cluster_rank);

-- Cluster metadata table — one row per cluster
CREATE TABLE IF NOT EXISTS faq_candidate_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  representative_id INTEGER NOT NULL,   -- faq_candidates.id of cluster rep
  size INTEGER NOT NULL DEFAULT 1,      -- member count
  avg_similarity REAL,                   -- internal cohesion (0..1)
  promoted INTEGER NOT NULL DEFAULT 0,   -- 1 when size >= frequency threshold
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (representative_id) REFERENCES faq_candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fcc_size ON faq_candidate_clusters(size DESC);
CREATE INDEX IF NOT EXISTS idx_fcc_promoted ON faq_candidate_clusters(promoted, size DESC);

-- Feature flag for hybrid retrieval (BM25 + Vectorize + RRF)
INSERT OR IGNORE INTO feature_flags (key, value, updated_at)
  VALUES ('retrieval.use_vectorize', '0', datetime('now'));

-- Vectorize index bookkeeping (what's been pushed vs what's stale)
CREATE TABLE IF NOT EXISTS vectorize_index_state (
  kind TEXT NOT NULL,                    -- 'kb_chunks' | 'faq_candidates'
  last_reindex_at TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,
  embedding_dim INTEGER,
  notes TEXT,
  PRIMARY KEY (kind)
);
INSERT OR IGNORE INTO vectorize_index_state (kind) VALUES ('kb_chunks');
INSERT OR IGNORE INTO vectorize_index_state (kind) VALUES ('faq_candidates');
