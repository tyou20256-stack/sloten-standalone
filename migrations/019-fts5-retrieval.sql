-- @idempotent — 019-fts5-retrieval.sql
-- Replaces the priority-ordered LIMIT 15 retrieval in ai-chat-adapter with
-- D1 FTS5 BM25. Japanese tokenization uses `unicode61 remove_diacritics 2`
-- which approximates bigram behavior for CJK — not perfect, but vastly better
-- than priority sort and works without Workers AI embeddings (施策 A, AI
-- Engineer report).

-- --- FAQ FTS5 virtual table ------------------------------------------------
DROP TABLE IF EXISTS faq_fts;
CREATE VIRTUAL TABLE faq_fts USING fts5(
  question,
  answer,
  category,
  content='faq',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Rebuild from existing rows (one-shot; subsequent writes handled by triggers).
INSERT INTO faq_fts(rowid, question, answer, category)
SELECT id, question, answer, COALESCE(category, '')
  FROM faq
 WHERE is_active = 1;

-- Triggers keep fts index aligned with faq table.
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

-- --- knowledge_sources FTS5 virtual table ---------------------------------
-- Content gets truncated to 8000 chars to keep fts index size reasonable.
-- When chunking (施策 E) lands in Phase 2, switch this to knowledge_chunks.
DROP TABLE IF EXISTS kb_fts;
CREATE VIRTUAL TABLE kb_fts USING fts5(
  title,
  content,
  content='knowledge_sources',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

INSERT INTO kb_fts(rowid, title, content)
SELECT id, COALESCE(title, ''), substr(COALESCE(content, ''), 1, 8000)
  FROM knowledge_sources
 WHERE is_active = 1;

DROP TRIGGER IF EXISTS kb_fts_ai;
CREATE TRIGGER kb_fts_ai AFTER INSERT ON knowledge_sources BEGIN
  INSERT INTO kb_fts(rowid, title, content)
    VALUES (new.id, COALESCE(new.title, ''), substr(COALESCE(new.content, ''), 1, 8000));
END;

DROP TRIGGER IF EXISTS kb_fts_ad;
CREATE TRIGGER kb_fts_ad AFTER DELETE ON knowledge_sources BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, title, content)
    VALUES('delete', old.id, COALESCE(old.title, ''), substr(COALESCE(old.content, ''), 1, 8000));
END;

DROP TRIGGER IF EXISTS kb_fts_au;
CREATE TRIGGER kb_fts_au AFTER UPDATE ON knowledge_sources BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, title, content)
    VALUES('delete', old.id, COALESCE(old.title, ''), substr(COALESCE(old.content, ''), 1, 8000));
  INSERT INTO kb_fts(rowid, title, content)
    VALUES (new.id, COALESCE(new.title, ''), substr(COALESCE(new.content, ''), 1, 8000));
END;
