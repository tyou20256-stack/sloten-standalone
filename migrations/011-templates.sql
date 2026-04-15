-- @idempotent — 011-templates.sql (ported from v1.0)

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'ja',
  shortcut TEXT,
  usage_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tpl_tenant ON templates(tenant_id, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_tpl_shortcut ON templates(tenant_id, shortcut) WHERE shortcut IS NOT NULL;
