-- @idempotent — 029-fts5-restore-triggers.sql
-- MIGRATION-LINT: safe (rebuild + DDL only; no data loss)
--
-- Restore the FAQ + KB FTS5 sync triggers that were silently dropped by
-- migration 024. Migration 024 did `DROP TABLE faq_fts` / `DROP TABLE kb_fts`
-- to switch from unicode61 to trigram tokenizer, which cascade-dropped the
-- six triggers defined in migration 019. The DDL never re-created them, so
-- every INSERT / UPDATE / DELETE on `faq` and `knowledge_sources` between
-- the 024 deploy and today has been *invisible to the FTS5 index*.
--
-- Observable consequence:
--   - New FAQ rows added via admin UI never appear in /api/faq/search FTS
--     results.
--   - Edited FAQ answers continue to return the pre-edit text in retrieval.
--   - Same drift for knowledge_sources → kb_fts.
--
-- Fix:
--   1) Rebuild both FTS indexes from the source content tables (FTS5's
--      built-in 'rebuild' command — no data loss, just re-tokenises).
--   2) Re-create all six triggers (same body as migration 019 but matched
--      to the trigram-tokeniser table shape introduced in 024).
--
-- The migration is safe to apply on databases that never lost the triggers
-- (DROP TRIGGER IF EXISTS + the rebuild is a no-op there).

-- --- (1) Rebuild FTS indexes from source rows ---
-- 'rebuild' is the official FTS5 command for re-syncing a contentless index
-- with its content table. Runs in a single internal transaction.
INSERT INTO faq_fts(faq_fts) VALUES('rebuild');
INSERT INTO kb_fts(kb_fts) VALUES('rebuild');

-- --- (2) Re-create faq triggers ---
DROP TRIGGER IF EXISTS faq_fts_ai;
CREATE TRIGGER faq_fts_ai AFTER INSERT ON faq BEGIN
  INSERT INTO faq_fts(rowid, question, answer, category)
    VALUES (new.id, new.question, new.answer, COALESCE(new.category, ''));
END;

DROP TRIGGER IF EXISTS faq_fts_ad;
CREATE TRIGGER faq_fts_ad AFTER DELETE ON faq BEGIN
  INSERT INTO faq_fts(faq_fts, rowid, question, answer, category)
    VALUES('delete', old.id, old.question, old.answer, COALESCE(old.category, ''));
END;

DROP TRIGGER IF EXISTS faq_fts_au;
CREATE TRIGGER faq_fts_au AFTER UPDATE ON faq BEGIN
  INSERT INTO faq_fts(faq_fts, rowid, question, answer, category)
    VALUES('delete', old.id, old.question, old.answer, COALESCE(old.category, ''));
  INSERT INTO faq_fts(rowid, question, answer, category)
    VALUES (new.id, new.question, new.answer, COALESCE(new.category, ''));
END;

-- --- (3) Re-create kb triggers ---
DROP TRIGGER IF EXISTS kb_fts_ai;
CREATE TRIGGER kb_fts_ai AFTER INSERT ON knowledge_sources BEGIN
  INSERT INTO kb_fts(rowid, title, content)
    VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''));
END;

DROP TRIGGER IF EXISTS kb_fts_ad;
CREATE TRIGGER kb_fts_ad AFTER DELETE ON knowledge_sources BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, title, content)
    VALUES('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''));
END;

DROP TRIGGER IF EXISTS kb_fts_au;
CREATE TRIGGER kb_fts_au AFTER UPDATE ON knowledge_sources BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, title, content)
    VALUES('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''));
  INSERT INTO kb_fts(rowid, title, content)
    VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''));
END;
