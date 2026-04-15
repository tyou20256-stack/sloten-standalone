-- @idempotent — 006-external-id-fix.sql
-- Partial UNIQUE indexes don't satisfy ON CONFLICT(external_id) in SQLite.
-- Replace with full UNIQUE indexes (NULLs remain distinct in SQLite so this is safe).

DROP INDEX IF EXISTS idx_contacts_external_id;
DROP INDEX IF EXISTS idx_conversations_external_id;
DROP INDEX IF EXISTS idx_messages_external_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_external_id      ON contacts(external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_external_id ON conversations(external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id      ON messages(external_id);
