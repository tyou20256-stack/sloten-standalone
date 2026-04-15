-- @idempotent — 012-knowledge.sql (ported from v1.0)

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  title TEXT,
  content TEXT,
  raw_html TEXT,
  metadata TEXT,
  source_type TEXT DEFAULT 'url',
  priority INTEGER DEFAULT 3,
  content_hash TEXT,
  auto_refresh INTEGER DEFAULT 0,
  last_refreshed_at TEXT,
  category TEXT DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ks_active_priority ON knowledge_sources(is_active, priority, id DESC);
CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_id, chunk_index);
