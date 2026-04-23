-- @idempotent — 018-ai-accuracy-phase1.sql
-- AI accuracy Phase 1 infrastructure from HANDOFF/ai-accuracy-discussion:
--   (1) ai_logs: tokens_in/out, retrieval_trace, escalation_reason columns
--   (2) golden_set: evaluation corpus for prompt/RAG regression testing
--   (3) silent-failure views: 即エスカ / 再質問 / 怒り語 3 種
--   (4) ai_prompts: deactivate polluting test entries (oor / oor-1145)

-- --- (1) ai_logs augmentation -----------------------------------------------
-- SQLite: column-add is non-destructive. IF NOT EXISTS not supported for
-- ALTER TABLE ADD COLUMN. tokens_in/out columns already exist from earlier
-- migration, so we only add the new ones here.
-- retrieval_trace: JSON { faq_ids: [...], kb_ids: [...], strategy: "fts5|legacy" }
ALTER TABLE ai_logs ADD COLUMN retrieval_trace TEXT;
-- When escalation was triggered instead of AI answer:
--   reason IN ('hard','anger','rg_soft','deadloop','threat','vip','none')
ALTER TABLE ai_logs ADD COLUMN escalation_reason TEXT;

-- --- (2) golden_set ---------------------------------------------------------
-- A curated set of (question, expected) pairs used by nightly eval batch to
-- score every active prompt + RAG variant. Used for A/B winner selection and
-- regression detection when prompts/KB change.
CREATE TABLE IF NOT EXISTS golden_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  category TEXT NOT NULL,                 -- 入出金 / ボーナス / アカウント / コンプライアンス / 雑談
  question TEXT NOT NULL,                 -- 顧客想定入力
  reference_answer TEXT,                  -- 模範回答 (reviewer 記入)
  must_contain TEXT,                      -- JSON array: 必須含有キーワード
  must_not_contain TEXT,                  -- JSON array: 禁止ワード (景表法など)
  expected_kb_ids TEXT,                   -- JSON array: 期待 KB ID
  expected_escalation INTEGER NOT NULL DEFAULT 0,  -- 1 = 人間エスカレが正解
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_golden_set_tenant_category
  ON golden_set(tenant_id, category);

-- --- (3) silent-failure views ----------------------------------------------
-- View A: AI answered, then within 120s the conversation was escalated (status → open).
-- This is a strong signal that AI's answer was insufficient.
DROP VIEW IF EXISTS v_ai_silent_escalation;
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

-- View B: Same contact asked similar questions within 10 minutes after AI response.
-- (Cheap heuristic — exact duplicate or first 20 chars match.)
DROP VIEW IF EXISTS v_ai_repeat_question;
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

-- View C: Customer next turn contains anger/frustration keywords.
-- Uses LIKE (SQLite has no REGEXP built-in). Broader Japanese set.
DROP VIEW IF EXISTS v_ai_anger_followup;
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

-- --- (4) ai_prompts cleanup -------------------------------------------------
-- Deactivate polluting test entries that were consuming 66% of traffic
-- with body = "x". Keeps them in table for audit but weight=0 + inactive.
UPDATE ai_prompts
   SET is_active = 0, weight = 0, updated_at = datetime('now')
 WHERE name IN ('oor', 'oor-1145')
    OR (length(trim(system_prompt)) <= 2 AND is_active = 1);
