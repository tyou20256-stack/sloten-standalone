-- @idempotent — 034-faq-vectorize-enable.sql
-- MIGRATION-LINT: safe (one state row + one feature_flag toggle; no data loss)
--
-- 2026-05-18 accuracy audit P3: enable hybrid (BM25 + dense RRF) retrieval and
-- register the new active-FAQ Vectorize index.
--
--   1. vectorize_index_state needs a 'faq' row so vectorizeReindex() can
--      record item_count after embedding (its final UPDATE is keyed by kind;
--      with no row the count would silently not persist).
--   2. retrieval.use_vectorize flips 0→1 so retrieveContext() takes the
--      hybrid path. The code degrades gracefully if the index is empty, but
--      the post-deploy runbook step backfills it (kb_chunks + faq) before
--      this matters in practice.
--
-- Idempotent: INSERT OR IGNORE for the state row; the flag is upserted to '1'
-- whether the row pre-exists ('0') or not.

INSERT OR IGNORE INTO vectorize_index_state (kind, item_count, notes)
  VALUES ('faq', 0, 'pending first reindex');

INSERT OR IGNORE INTO feature_flags (key, value, updated_at)
  VALUES ('retrieval.use_vectorize', '1', datetime('now'));

UPDATE feature_flags
   SET value = '1', updated_at = datetime('now')
 WHERE key = 'retrieval.use_vectorize' AND value <> '1';
