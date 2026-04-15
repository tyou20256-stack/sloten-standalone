-- @idempotent — 009-bot-menus.sql
-- Bot menus for input_select presentation. Three modes:
--   default  — auto-sent on conversation create (welcome menu)
--   keyword  — trigger_value is a regex; matches on customer message
--   fallback — used when AI returns empty / "handoff" reply

CREATE TABLE IF NOT EXISTS bot_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('default','keyword','fallback')),
  trigger_value TEXT,                          -- regex for keyword; NULL otherwise
  prompt TEXT NOT NULL DEFAULT '',             -- text shown above the buttons
  items TEXT NOT NULL,                         -- JSON array [{title, value}]
  priority INTEGER NOT NULL DEFAULT 0,         -- higher = checked first
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bot_menus_lookup ON bot_menus(tenant_id, trigger_type, is_active, priority DESC);

-- Seed: default welcome menu — overwrite existing row by idempotent name.
INSERT OR IGNORE INTO bot_menus (tenant_id, name, trigger_type, trigger_value, prompt, items, priority, is_active) VALUES
('tenant_default', 'welcome', 'default', NULL,
 'こんにちは！ご用件をお選びください。',
 '[{"title":"入金について","value":"入金"},{"title":"出金について","value":"出金"},{"title":"アカウント・ログイン","value":"アカウント"},{"title":"キャンペーン・ボーナス","value":"ボーナス"},{"title":"その他","value":"その他"}]',
 100, 1);

-- Seed: fallback — used when AI reply is empty.
INSERT OR IGNORE INTO bot_menus (tenant_id, name, trigger_type, trigger_value, prompt, items, priority, is_active) VALUES
('tenant_default', 'handoff-fallback', 'fallback', NULL,
 'うまく回答できませんでした。オペレーターにおつなぎしますか？',
 '[{"title":"オペレーターにつなぐ","value":"オペレーター"},{"title":"メニューに戻る","value":"メニュー"}]',
 100, 1);
