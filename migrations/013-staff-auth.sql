-- @idempotent — 013-staff-auth.sql (consolidated from v1.0 003/007/014)

CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'agent' CHECK(role IN ('admin','agent','viewer')),
  phone TEXT,
  department TEXT,
  hired_at TEXT,
  bio TEXT,
  language TEXT DEFAULT 'ja',
  password_hash TEXT,
  password_salt TEXT,
  session_token_hash TEXT,
  session_expires_at TEXT,
  failed_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_session ON staff_members(session_token_hash) WHERE session_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_members(email);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT,
  settings TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant_default', 'Default Tenant');

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
