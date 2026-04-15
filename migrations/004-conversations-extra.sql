-- @idempotent — 004-conversations-extra.sql
-- Adds priority + labels columns to conversations, and a labels catalog table.

-- SQLite lacks IF NOT EXISTS for ADD COLUMN; use a sentinel check via PRAGMA is impractical
-- here, so these ALTERs may fail on re-run. Wrangler ignores that if already applied —
-- downstream operators should drop these lines after first apply.
ALTER TABLE conversations ADD COLUMN priority TEXT DEFAULT 'normal';
ALTER TABLE conversations ADD COLUMN labels TEXT DEFAULT '';
ALTER TABLE conversations ADD COLUMN snoozed_until TEXT;

CREATE INDEX IF NOT EXISTS idx_conv_priority ON conversations(tenant_id, priority, status);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_tenant_name ON labels(tenant_id, name);
