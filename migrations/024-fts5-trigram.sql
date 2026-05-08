-- @idempotent — 024-fts5-trigram.sql
-- Switch faq_fts and kb_fts to trigram tokenizer so Japanese queries (no
-- whitespace) can match. Default unicode61 keeps "paypay入金方法" as a single
-- token, which never matches stored content. Trigram tokenization indexes
-- every 3-character window, enabling substring matches across CJK.
--
-- Side effect: index size grows ~3x but stays modest (faq+kb is < 200 rows).
-- BM25 ranking still works.

DROP TABLE IF EXISTS faq_fts;
DROP TABLE IF EXISTS kb_fts;

CREATE VIRTUAL TABLE faq_fts USING fts5(
  question,
  answer,
  category,
  content='faq',
  content_rowid='id',
  tokenize='trigram'
);

CREATE VIRTUAL TABLE kb_fts USING fts5(
  title,
  content,
  content='knowledge_sources',
  content_rowid='id',
  tokenize='trigram'
);

-- Re-populate indexes from source tables
INSERT INTO faq_fts(rowid, question, answer, category)
SELECT id, question, answer, COALESCE(category, '') FROM faq WHERE is_active = 1;

INSERT INTO kb_fts(rowid, title, content)
SELECT id, title, content FROM knowledge_sources WHERE is_active = 1;
