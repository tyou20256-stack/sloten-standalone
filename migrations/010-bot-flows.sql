-- @idempotent — 010-bot-flows.sql
-- Multi-step bot conversation flows with webhook integration (GAS etc.).
--
-- Each flow is a directed graph of named steps. At any time a conversation
-- may be "inside" one flow — its flow_state JSON holds {flow_id, step_id,
-- vars:{...}}. A flow starts when either (a) the customer message matches a
-- flow's trigger regex, or (b) a static bot_menu button's value matches
-- (via the generic entry mechanism).

CREATE TABLE IF NOT EXISTS bot_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'entry' CHECK (trigger_type IN ('entry','manual')),
  trigger_value TEXT,        -- regex when trigger_type=entry
  start_step_id TEXT NOT NULL,
  steps TEXT NOT NULL,       -- JSON array of step objects (see docs in bot-flows.mjs)
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bot_flows_active ON bot_flows(tenant_id, is_active, priority DESC);

-- flow_state json: {"flow_id": 1, "step_id": "ask_amount", "vars": {...}}
ALTER TABLE conversations ADD COLUMN flow_state TEXT;
