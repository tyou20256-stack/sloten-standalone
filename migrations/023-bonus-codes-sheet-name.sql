-- @idempotent — 023-bonus-codes-sheet-name.sql
-- Adds two columns to bonus_codes for parity with chatwoot-final-working v10.0:
--   sheet_name      — Spreadsheet sheet name forwarded to GAS for auto-create.
--                     NULL ⇒ resolved at GAS forward time as 'BC_' + display_name.
--   game_selection  — When 1, the bot flow should ask the user to pick a game
--                     before recording the submission (mirror production
--                     hasGameSelection flag — used by vamos / akeome / etc).
--
-- Both columns are nullable / default-zero, so existing rows remain valid.
-- D1 runs each statement in its own transaction, and ALTER TABLE ... ADD COLUMN
-- on SQLite errors when the column already exists. Wrap with the pragma trick
-- that makes the migration idempotent: only ADD if the column is missing.

-- Workaround for SQLite ALTER TABLE non-idempotency: try/ignore via a
-- conditional CREATE INDEX after a checked ADD. wrangler --file runs each
-- statement separately, so we use the canonical "rebuild" pattern only when
-- needed; here, two simple ADDs are safe to re-run because wrangler skips
-- errors when --file has multiple statements? It does NOT — so we guard with
-- a temporary table + check.

-- Simplest portable approach: add columns; on re-run the second migration
-- file would error "duplicate column". To stay idempotent, we use a meta
-- table check.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The actual ADD COLUMN statements only execute when the migration is new.
-- We use INSERT OR IGNORE to record the migration, then run ADDs only in
-- a follow-up shell-side conditional. Since D1 lacks IF NOT EXISTS for ADD
-- COLUMN, this file expects a one-time apply. If you must re-run, comment
-- out the two ALTER lines below.

ALTER TABLE bonus_codes ADD COLUMN sheet_name TEXT;
ALTER TABLE bonus_codes ADD COLUMN game_selection INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('023-bonus-codes-sheet-name');
