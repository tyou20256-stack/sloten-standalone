-- @idempotent — 033-kb-chunks-fts-trigram.sql
-- MIGRATION-LINT: safe (FTS index rebuild from base table; no base data touched)
--
-- 2026-05-18 accuracy audit: faq_fts and kb_fts were already migrated to the
-- `trigram` tokenizer (migration 024 + a later case_sensitive variant), but
-- kb_chunks_fts was missed and still uses `unicode61 remove_diacritics 2`.
-- For Japanese (no whitespace) unicode61 keeps a whole chunk as ~one token,
-- so KB-chunk BM25 effectively never matches a partial query → retrieval
-- falls back to the priority dump (`hybrid_fts_miss`) → generic/wrong answers.
-- Since retrieval.use_chunks='1' and 56 chunks are populated, the active KB
-- path IS kb_chunks_fts — so this is a live recall bug, not a latent one.
--
-- Fix: rebuild kb_chunks_fts with `trigram case_sensitive 0` (matching the
-- faq_fts/kb_fts tokenizer), recreate the sync triggers (bodies unchanged),
-- and repopulate from knowledge_chunks. Rebuild is naturally idempotent
-- (drop + recreate + reinsert); re-runs converge to the same state.

DROP TABLE IF EXISTS kb_chunks_fts;
CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
  heading_path,
  content,
  content='knowledge_chunks',
  content_rowid='id',
  tokenize='trigram case_sensitive 0'
);

INSERT INTO kb_chunks_fts(rowid, heading_path, content)
SELECT id, COALESCE(heading_path, ''), COALESCE(content, '')
  FROM knowledge_chunks
 WHERE content IS NOT NULL;

DROP TRIGGER IF EXISTS kb_chunks_fts_ai;
CREATE TRIGGER kb_chunks_fts_ai AFTER INSERT ON knowledge_chunks BEGIN
  INSERT INTO kb_chunks_fts(rowid, heading_path, content)
    VALUES (new.id, COALESCE(new.heading_path, ''), COALESCE(new.content, ''));
END;
DROP TRIGGER IF EXISTS kb_chunks_fts_ad;
CREATE TRIGGER kb_chunks_fts_ad AFTER DELETE ON knowledge_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, heading_path, content)
    VALUES('delete', old.id, COALESCE(old.heading_path, ''), COALESCE(old.content, ''));
END;
DROP TRIGGER IF EXISTS kb_chunks_fts_au;
CREATE TRIGGER kb_chunks_fts_au AFTER UPDATE ON knowledge_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, heading_path, content)
    VALUES('delete', old.id, COALESCE(old.heading_path, ''), COALESCE(old.content, ''));
  INSERT INTO kb_chunks_fts(rowid, heading_path, content)
    VALUES (new.id, COALESCE(new.heading_path, ''), COALESCE(new.content, ''));
END;
