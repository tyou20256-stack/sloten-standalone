-- @idempotent — 010-faq.sql (ported from v1.0, consolidated)

CREATE TABLE IF NOT EXISTS faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  language TEXT DEFAULT 'ja',
  keywords TEXT,
  priority INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_tenant_active ON faq(tenant_id, is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(tenant_id, category);
