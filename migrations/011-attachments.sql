-- @idempotent — 011-attachments.sql
-- File attachments stored in Cloudflare R2. The object key is a UUID; the
-- metadata row links the R2 object to the conversation/message.

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,                                 -- UUID, used as the R2 key
  conversation_id TEXT NOT NULL,
  message_id TEXT,                                     -- nullable: file may be uploaded before its message row is sent
  uploaded_by TEXT NOT NULL DEFAULT 'customer' CHECK (uploaded_by IN ('customer','staff','bot')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id) WHERE message_id IS NOT NULL;
