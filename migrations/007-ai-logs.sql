-- @idempotent — 007-ai-logs.sql
-- Per-call AI log + staff feedback for quality evaluation.

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  conversation_id TEXT,
  message_id TEXT,
  provider TEXT NOT NULL,             -- gemini | anthropic
  model TEXT NOT NULL,
  system_prompt TEXT,                 -- truncated to first 2KB
  input TEXT,                         -- customer message (PII-masked)
  output TEXT,                        -- AI response
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',  -- ok | error | empty
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant_status ON ai_logs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation ON ai_logs(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_log_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ai_log_id INTEGER NOT NULL,
  staff_id INTEGER,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),  -- -1 = 👎, 1 = 👍
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ai_log_id) REFERENCES ai_logs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_log_staff ON ai_log_feedback(ai_log_id, staff_id);
