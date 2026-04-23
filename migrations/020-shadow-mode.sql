-- @idempotent — 020-shadow-mode.sql
-- Shadow mode infrastructure (HANDOFF/ai-accuracy-discussion/03-experiment-tracker.md §3)
-- Purpose: test candidate prompts in parallel without user-visible impact.
-- The primary (active) response is returned to the user; shadow executions
-- are logged silently for later pairwise comparison / LLM-as-Judge scoring.

-- ai_logs additions ---------------------------------------------------------
ALTER TABLE ai_logs ADD COLUMN is_shadow INTEGER NOT NULL DEFAULT 0;
-- When is_shadow=1, shadow_of points to the primary ai_logs.id that was
-- user-visible. This lets us join pairs for A/B analysis.
ALTER TABLE ai_logs ADD COLUMN shadow_of INTEGER;
-- Judge scores (populated by scripts/eval-golden-set.mjs or nightly batch).
-- JSON { "judge": "claude-haiku-4-5", "score": 4.2, "reasoning": "..." }
ALTER TABLE ai_logs ADD COLUMN judge_score TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_logs_shadow_of ON ai_logs(shadow_of);

-- feature_flags bootstrap ---------------------------------------------------
-- Enables/disables shadow mode at runtime without redeploy. Default disabled
-- to keep LLM cost ~1x until operator opts in.
INSERT OR IGNORE INTO feature_flags (key, value, updated_at)
  VALUES ('ai.shadow_mode.enabled', '0', datetime('now'));
-- Comma-separated prompt IDs to run as shadows. e.g. "3,4"
INSERT OR IGNORE INTO feature_flags (key, value, updated_at)
  VALUES ('ai.shadow_mode.prompt_ids', '', datetime('now'));

-- eval results cache --------------------------------------------------------
-- Stores per-(prompt_id, golden_set_id) evaluation snapshots so the admin
-- dashboard can show rolling A/B Golden-Set scores without re-running the
-- LLM on every page load.
CREATE TABLE IF NOT EXISTS golden_eval (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id INTEGER NOT NULL,
  golden_set_id INTEGER NOT NULL,
  ai_response TEXT,
  keyword_inclusion_score REAL,    -- 0..1
  must_not_contain_violated INTEGER NOT NULL DEFAULT 0,
  expected_escalation_match INTEGER NOT NULL DEFAULT 0,
  judge_score REAL,                -- 1..5 LLM-as-Judge
  judge_reasoning TEXT,
  latency_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  run_batch_id TEXT               -- groups all rows of a nightly run
);
CREATE INDEX IF NOT EXISTS idx_golden_eval_prompt ON golden_eval(prompt_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_golden_eval_batch ON golden_eval(run_batch_id);

-- escalation_reason expansion (Phase 2 H) ----------------------------------
-- We now also emit: 'negative_sentiment', 'deadloop_full'. No schema change —
-- the column is free-form TEXT. This migration is a documentation marker.
