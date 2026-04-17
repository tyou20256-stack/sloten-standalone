-- @idempotent — 015-admin-ops.sql
-- Admin operations infrastructure: audit log, error log, env overrides.
-- Adds the operational features that the production chatwoot-bot admin
-- has (test-webhook, GAS URL editor, GAS ping, audit log, error log,
-- backup/restore) to the standalone admin console.

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  staff_id INTEGER,
  staff_email TEXT,
  action TEXT NOT NULL,                 -- e.g. 'bonus_code.create', 'gas_url.update'
  resource_type TEXT,                   -- e.g. 'bonus_code', 'env_override'
  resource_id TEXT,
  payload TEXT,                         -- JSON snapshot of what changed
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_staff ON audit_log(staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  source TEXT NOT NULL,                 -- e.g. 'sendMessage', 'webhook:GAS', 'flow:webhook'
  message TEXT NOT NULL,
  stack TEXT,
  context TEXT,                         -- JSON: arbitrary debug fields
  conversation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_tenant ON error_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_source ON error_log(tenant_id, source, created_at DESC);

-- Env overrides: lets admin change values like GAS_BOT_WEBHOOK_URL from the
-- UI without redeploying. Worker code reads via getEnv(env, key) which checks
-- this table first, then falls back to env[key]. Cleared values delete the row.
CREATE TABLE IF NOT EXISTS env_overrides (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
