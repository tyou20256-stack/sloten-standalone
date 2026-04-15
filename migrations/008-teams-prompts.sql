-- @idempotent — 008-teams-prompts.sql
-- Teams, team membership, AI prompts (A/B), and ai_logs.prompt_id link.

-- === Teams ===
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_tenant_name ON teams(tenant_id, name);

CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, staff_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_members_staff ON team_members(staff_id);

-- conversations.team_id (no ALTER IF NOT EXISTS in SQLite; re-run is a no-op failure
-- but wrangler d1 execute treats the whole file as atomic, so a partially applied
-- rerun is harmless).
ALTER TABLE conversations ADD COLUMN team_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_conv_team ON conversations(team_id) WHERE team_id IS NOT NULL;

-- === AI prompts (A/B testing) ===
CREATE TABLE IF NOT EXISTS ai_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_prompts_active ON ai_prompts(tenant_id, is_active, weight);

-- ai_logs link
ALTER TABLE ai_logs ADD COLUMN prompt_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ai_logs_prompt ON ai_logs(prompt_id) WHERE prompt_id IS NOT NULL;

-- Seed two default prompts (A = detailed current style, B = concise).
INSERT OR IGNORE INTO ai_prompts (tenant_id, name, description, system_prompt, weight, is_active) VALUES
('tenant_default', 'default-A-detailed', '現行プロンプト (丁寧で詳細)',
 'あなたはスロット天国のカスタマーサポート担当です。' || char(10) ||
 '日本語で簡潔に、丁寧に回答してください。' || char(10) ||
 'FAQ やナレッジに情報がない場合は「担当者におつなぎします」と案内してください。',
 50, 1),
('tenant_default', 'default-B-concise', '簡潔版 (短く要点のみ)',
 'スロット天国サポート。日本語で 1〜2 文、要点のみで回答。' || char(10) ||
 '情報が無ければ「担当者に繋ぎます」と返す。',
 50, 1);
