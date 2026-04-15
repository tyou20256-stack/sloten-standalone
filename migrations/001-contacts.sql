-- @idempotent — 001-contacts.sql
-- End-customers (widget users). Anonymous sessions allowed.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  email TEXT,
  phone TEXT,
  name TEXT,
  avatar_url TEXT,
  metadata TEXT,
  is_identified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(tenant_id, phone) WHERE phone IS NOT NULL;
