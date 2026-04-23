-- @idempotent — 021-knowledge-chunks.sql
-- Populates knowledge_chunks (existing empty table) with chunking metadata
-- and adds a FTS5 index for chunk-level retrieval.
-- Actual row insertion is done by scripts/chunk-knowledge.mjs which needs
-- Node access to parse markdown — we just prep the schema + index here.

-- knowledge_chunks augmentation (table created in earlier migration 012)
-- Add missing metadata columns (embedding_vector stored in Vectorize, not D1).
ALTER TABLE knowledge_chunks ADD COLUMN heading_path TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN token_count INTEGER;
ALTER TABLE knowledge_chunks ADD COLUMN content_hash TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN embedding_model TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN embedding_version INTEGER;
ALTER TABLE knowledge_chunks ADD COLUMN vectorize_id TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Note: existing idx_kc_source already covers (source_id, chunk_index).
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_hash ON knowledge_chunks(content_hash);

-- FTS5 on chunks — finer-grained BM25 than whole-document kb_fts.
-- When this table is populated, retrieval.mjs prefers kb_chunks_fts over
-- kb_fts for higher precision.
DROP TABLE IF EXISTS kb_chunks_fts;
CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
  heading_path,
  content,
  content='knowledge_chunks',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- No rebuild from existing rows — the chunks table is currently empty and
-- scripts/chunk-knowledge.mjs will insert + trigger FTS sync.
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

-- Feature flag for enabling chunk-level retrieval (off until population)
INSERT OR IGNORE INTO feature_flags (key, value, updated_at)
  VALUES ('retrieval.use_chunks', '0', datetime('now'));
