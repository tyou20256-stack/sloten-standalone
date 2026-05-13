-- @idempotent — 030-perf-indexes-followup.sql
-- MIGRATION-LINT: safe (additive indexes only)
--
-- Two indexes flagged in the 2026-05-13 second-pass perf audit:
--
-- M2 (DB audit): dashboard.mjs and any future time-range message counts run
--   COUNT(*) WHERE tenant_id = ? AND created_at >= ?
-- The existing `idx_msg_tenant_sender (tenant_id, sender_type, created_at)`
-- needs a sender_type equality to be useful. Without it, the planner does
-- a wide range scan. Mirror the ai_logs fix from migration 028.
CREATE INDEX IF NOT EXISTS idx_msg_tenant_created
  ON messages(tenant_id, created_at DESC);

-- H1 partial index: deleteBotFlow does a `LIKE '%"flow_id":...%'` over
-- conversations.flow_state. It's an admin write so not on the hot read
-- path, but the LIKE forces a sequential scan over every row in the tenant
-- — most of which have flow_state IS NULL. A partial index drops the
-- iteration set to active flows only, which is typically <10% of rows.
CREATE INDEX IF NOT EXISTS idx_conv_active_flow
  ON conversations(tenant_id) WHERE flow_state IS NOT NULL;
