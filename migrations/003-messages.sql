-- @idempotent — 003-messages.sql

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  sender_type TEXT NOT NULL CHECK(sender_type IN ('customer','bot','staff','system')),
  sender_id TEXT,
  content TEXT,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK(content_type IN ('text','input_select','file','system_event')),
  content_attributes TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_msg_tenant_sender ON messages(tenant_id, sender_type, created_at DESC);
