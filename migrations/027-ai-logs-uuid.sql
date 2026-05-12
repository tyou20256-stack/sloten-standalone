-- @idempotent — 027-ai-logs-uuid.sql (skipped on re-run via _schema_migrations tracker)
-- MIGRATION-LINT: safe (table-rebuild for type change; data preserved through legacy_id mapping)
--
-- Convert ai_logs.id and ai_log_feedback.ai_log_id from INTEGER (autoincrement)
-- to TEXT (UUID). This lets the application generate the id upfront and dispatch
-- the INSERT via ctx.waitUntil() without awaiting the round-trip — eliminating
-- the 20–80 ms latency tax recordAiCall adds to every AI reply.
--
-- The migration:
--   1) Builds new ai_logs / ai_log_feedback tables with TEXT id columns.
--   2) Copies rows from the old tables, synthesizing UUIDs as lower(hex(randomblob(16)))
--      and preserving the old INTEGER id in a `legacy_id` column for forensic lookup.
--   3) Re-links shadow_of (self-reference inside ai_logs) via the legacy_id mapping.
--   4) Re-links ai_log_feedback.ai_log_id to the new TEXT id via the same mapping.
--   5) Drops the old tables, renames the new ones, and re-creates indexes + views.
--
-- Idempotency: scripts/apply-migrations.mjs records applied migrations in
-- _schema_migrations and skips them on re-run. Re-running this file directly
-- against a DB where ai_logs already has TEXT id will fail at the INSERT stage
-- (legacy_id is INTEGER but ai_logs.id would be TEXT) — that's intentional and
-- acceptable because the tracker prevents re-application via normal flow.

-- Step 1: New ai_logs schema with TEXT id + legacy_id mapping column.
CREATE TABLE IF NOT EXISTS ai_logs_new (
  id TEXT PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  conversation_id TEXT,
  message_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT,
  input TEXT,
  output TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  prompt_id INTEGER,
  retrieval_trace TEXT,
  escalation_reason TEXT,
  is_shadow INTEGER NOT NULL DEFAULT 0,
  shadow_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy rows, synthesizing UUIDs. shadow_of is intentionally NULL here —
-- re-linked in step 3 once every row has both id and legacy_id populated.
INSERT INTO ai_logs_new (
  id, legacy_id, tenant_id, conversation_id, message_id, provider, model,
  system_prompt, input, output, tokens_in, tokens_out, latency_ms,
  status, error_message, prompt_id, retrieval_trace, escalation_reason,
  is_shadow, shadow_of, created_at
)
SELECT
  lower(hex(randomblob(16))),
  id,
  tenant_id, conversation_id, message_id, provider, model,
  system_prompt, input, output, tokens_in, tokens_out, latency_ms,
  status, error_message, prompt_id, retrieval_trace, escalation_reason,
  is_shadow,
  NULL,
  created_at
FROM ai_logs;

-- Step 3: Re-link shadow_of using legacy_id mapping (TEXT pointer to new id).
UPDATE ai_logs_new
SET shadow_of = (
  SELECT v2.id FROM ai_logs_new v2
  WHERE v2.legacy_id = (
    SELECT shadow_of FROM ai_logs WHERE id = ai_logs_new.legacy_id
  )
)
WHERE legacy_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM ai_logs WHERE id = ai_logs_new.legacy_id AND shadow_of IS NOT NULL
  );

-- Step 4: New ai_log_feedback with TEXT FK to ai_logs.id.
CREATE TABLE IF NOT EXISTS ai_log_feedback_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ai_log_id TEXT NOT NULL,
  staff_id INTEGER,
  rating INTEGER NOT NULL CHECK (rating IN (-2, -1, 1)),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 5: Migrate feedback rows via legacy_id mapping.
INSERT INTO ai_log_feedback_new (id, ai_log_id, staff_id, rating, note, created_at)
SELECT f.id, v2.id, f.staff_id, f.rating, f.note, f.created_at
FROM ai_log_feedback f
INNER JOIN ai_logs_new v2 ON v2.legacy_id = f.ai_log_id;

-- Step 6: Drop old tables + views and swap names. Views must be dropped first
-- since they reference ai_logs.id.
DROP VIEW IF EXISTS v_ai_silent_escalation;
DROP VIEW IF EXISTS v_ai_repeat_question;
DROP VIEW IF EXISTS v_ai_anger_followup;
DROP TABLE IF EXISTS ai_log_feedback;
DROP TABLE IF EXISTS ai_logs;
ALTER TABLE ai_logs_new RENAME TO ai_logs;
ALTER TABLE ai_log_feedback_new RENAME TO ai_log_feedback;

-- Step 7: Re-create indexes (names match the original schema for tooling parity).
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant_status ON ai_logs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_conversation ON ai_logs(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_shadow_of ON ai_logs(shadow_of);
CREATE INDEX IF NOT EXISTS idx_ai_logs_legacy_id ON ai_logs(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_log_staff ON ai_log_feedback(ai_log_id, staff_id);

-- Step 8: Re-create the silent-failure views (logic identical to 018; only ai_log_id is now TEXT).
CREATE VIEW v_ai_silent_escalation AS
SELECT
  a.id           AS ai_log_id,
  a.conversation_id,
  a.prompt_id,
  a.output       AS ai_response,
  c.status,
  c.updated_at   AS conv_updated_at,
  a.created_at   AS ai_created_at,
  (julianday(c.updated_at) - julianday(a.created_at)) * 86400 AS seconds_until_escalation
FROM ai_logs a
JOIN conversations c ON c.id = a.conversation_id
WHERE a.status = 'ok'
  AND c.status = 'open'
  AND julianday(c.updated_at) > julianday(a.created_at)
  AND (julianday(c.updated_at) - julianday(a.created_at)) * 86400 < 120;

CREATE VIEW v_ai_repeat_question AS
SELECT
  a.id           AS ai_log_id,
  a.conversation_id,
  a.input        AS first_question,
  m.content      AS followup_message,
  a.created_at   AS ai_created_at,
  m.created_at   AS followup_created_at
FROM ai_logs a
JOIN messages m
  ON m.conversation_id = a.conversation_id
 AND m.sender_type = 'customer'
 AND julianday(m.created_at) > julianday(a.created_at)
 AND (julianday(m.created_at) - julianday(a.created_at)) * 86400 BETWEEN 10 AND 600
WHERE a.status = 'ok'
  AND (
    substr(trim(lower(a.input)), 1, 20) = substr(trim(lower(m.content)), 1, 20)
    OR m.content LIKE '%' || substr(a.input, 1, 15) || '%'
  );

CREATE VIEW v_ai_anger_followup AS
SELECT
  a.id           AS ai_log_id,
  a.conversation_id,
  a.output       AS ai_response,
  m.content      AS followup_message,
  a.created_at   AS ai_created_at,
  m.created_at   AS followup_created_at
FROM ai_logs a
JOIN messages m
  ON m.conversation_id = a.conversation_id
 AND m.sender_type = 'customer'
 AND julianday(m.created_at) > julianday(a.created_at)
 AND (julianday(m.created_at) - julianday(a.created_at)) * 86400 < 600
WHERE a.status = 'ok'
  AND (
    m.content LIKE '%違う%'
    OR m.content LIKE '%分からない%'
    OR m.content LIKE '%わからない%'
    OR m.content LIKE '%人に%'
    OR m.content LIKE '%オペレーター%'
    OR m.content LIKE '%担当者%'
    OR m.content LIKE '%詐欺%'
    OR m.content LIKE '%返金%'
    OR m.content LIKE '%金返せ%'
    OR m.content LIKE '%訴え%'
    OR m.content LIKE '%ふざけ%'
    OR m.content LIKE '%最悪%'
    OR m.content = '？'
    OR m.content = 'は？'
  );
