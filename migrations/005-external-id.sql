-- @idempotent — 005-external-id.sql
-- Stable cross-system identifier (e.g. "chatwoot:3:conv:1234") for idempotent
-- imports from external systems.

ALTER TABLE contacts      ADD COLUMN external_id TEXT;
ALTER TABLE conversations ADD COLUMN external_id TEXT;
ALTER TABLE messages      ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_external_id      ON contacts(external_id)      WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_external_id ON conversations(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id      ON messages(external_id)      WHERE external_id IS NOT NULL;
