-- @idempotent — 012-faq-candidates.sql
-- Pending FAQ candidates extracted weekly from customer→staff Q&A pairs.
-- Admin reviews and promotes approved rows into `faq`.

CREATE TABLE IF NOT EXISTS faq_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  cluster_key TEXT NOT NULL,              -- normalized question prefix used for dedup
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  source_count INTEGER NOT NULL DEFAULT 1, -- how many times this cluster was seen
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INTEGER,                    -- staff_members.id
  reviewed_at TEXT,
  approved_faq_id INTEGER,                -- FK to faq.id once promoted
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_candidates_cluster ON faq_candidates(tenant_id, cluster_key);
CREATE INDEX IF NOT EXISTS idx_faq_candidates_status ON faq_candidates(tenant_id, status, source_count DESC);

-- Feature flag key used by scheduled.mjs to track last successful run.
INSERT OR IGNORE INTO feature_flags (key, value) VALUES ('faq_extract_last_run_ts', '0');
