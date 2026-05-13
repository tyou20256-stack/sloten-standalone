-- @idempotent — 028-ai-logs-tenant-created-index.sql
-- MIGRATION-LINT: safe (additive index only)
--
-- aiStats issues 4 sequential time-range count queries on ai_logs:
--   COUNT(*) WHERE tenant_id = ? AND created_at >= datetime('now','-1 day')
--   COUNT(*) WHERE tenant_id = ? AND created_at >= datetime('now','-7 day')
--   COUNT(*) WHERE tenant_id = ? AND status = 'error' AND created_at >= ...
--   AVG(latency_ms) WHERE tenant_id = ? AND status = 'ok' AND created_at >= ...
--
-- The existing `idx_ai_logs_tenant_status (tenant_id, status, created_at)` is
-- selective for status-filtered queries but the unfiltered count queries
-- (calls_24h / calls_7d) can't use it efficiently — they have to walk the
-- leading-column prefix without status equality.
--
-- This index adds (tenant_id, created_at DESC) so both count queries do a
-- bounded index range scan instead of a wider tenant_status scan. Estimated
-- save: 20–100 ms per dashboard refresh (Perf audit M7, 2026-05-13).

CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant_created
  ON ai_logs(tenant_id, created_at DESC);
