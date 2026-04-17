-- @idempotent — 014-bonus-codes.sql
-- Bonus code definitions + submission history. Ports the production
-- Chatwoot bot's bonus code system (24 hardcoded types + KV dynamic codes)
-- into D1 with an admin UI.

CREATE TABLE IF NOT EXISTS bonus_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  -- Stable key, e.g. 'vamos', 'stepup', 'suroten_dream'. Referenced from
  -- ported code if any, and used for GAS webhook `type` field.
  type_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- JSON array of accepted code strings (after space removal + match-mode
  -- normalization). E.g. ["バモスイボナ","ばもすいぼな"].
  codes TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'case_insensitive' CHECK (match_mode IN ('exact','case_insensitive')),
  -- Success response. Either a plain text `content` + optional `items`
  -- (select options), OR a JSON object {content, items:[{title,value}]}.
  success_content TEXT NOT NULL,
  success_items TEXT,                       -- JSON array of {title, value} or NULL
  -- Downstream behavior flags (mirror production HARDCODED_MAP):
  gas_type TEXT,                            -- e.g. 'BC_入学' | 'BC_ギルド' | NULL
  transfer_after INTEGER NOT NULL DEFAULT 0,-- if 1, hand off to human after ack
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'hardcoded' CHECK (source IN ('hardcoded','dynamic')),
  priority INTEGER NOT NULL DEFAULT 0,      -- higher = matched first
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_codes_type_key ON bonus_codes(tenant_id, type_key);
CREATE INDEX IF NOT EXISTS idx_bonus_codes_enabled ON bonus_codes(tenant_id, enabled, priority DESC);

-- Submissions: who submitted which code when. Used for admin history view
-- and to optionally forward to GAS (bonus-code-specific webhook).
CREATE TABLE IF NOT EXISTS bonus_code_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  conversation_id TEXT NOT NULL,
  contact_id TEXT,
  bonus_code_id INTEGER,       -- NULL when code was disabled at time of submission
  type_key TEXT,               -- denormalized for history even if code is deleted
  code_submitted TEXT NOT NULL,
  gas_forwarded INTEGER NOT NULL DEFAULT 0,
  gas_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bonus_sub_conv ON bonus_code_submissions(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bonus_sub_tenant ON bonus_code_submissions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bonus_sub_type ON bonus_code_submissions(tenant_id, type_key, created_at DESC);
