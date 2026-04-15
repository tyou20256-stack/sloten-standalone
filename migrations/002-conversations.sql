-- @idempotent — 002-conversations.sql

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'bot' CHECK(status IN ('bot','open','closed')),
  assignee_id INTEGER,
  last_message_at TEXT,
  last_message_preview TEXT,
  unread_count_staff INTEGER NOT NULL DEFAULT 0,
  unread_count_customer INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE INDEX IF NOT EXISTS idx_conv_tenant_status ON conversations(tenant_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_assignee ON conversations(assignee_id, status) WHERE assignee_id IS NOT NULL;
