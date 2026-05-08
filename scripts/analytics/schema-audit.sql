-- DB schema audit — detects missing indexes and suboptimal query plans for
-- the hot paths in the worker. Run quarterly or after schema changes.
--
-- Usage:
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/schema-audit.sql

-- 1) All indexes with size estimate (count of unique values per indexed column)
-- Useful for detecting low-cardinality indexes that won't help much.
SELECT name, tbl_name, sql FROM sqlite_master
WHERE type='index' AND sql IS NOT NULL
ORDER BY tbl_name, name;

-- 2) Hot path: messages by conversation_id + created_at (admin panel scroll)
EXPLAIN QUERY PLAN
SELECT id, content, sender_type, created_at
FROM messages WHERE conversation_id = 'x' ORDER BY created_at DESC LIMIT 50;

-- 3) Hot path: ai_logs by tenant + status + created_at (metrics monitor)
EXPLAIN QUERY PLAN
SELECT status, latency_ms FROM ai_logs
WHERE created_at >= datetime('now', '-5 minutes');

-- 4) Hot path: conversations list for admin (status='open' first)
EXPLAIN QUERY PLAN
SELECT id, contact_id, status, last_message_at FROM conversations
WHERE tenant_id = 'tenant_default' AND status IN ('open', 'bot')
ORDER BY last_message_at DESC LIMIT 50;

-- 5) Hot path: FAQ search by tenant + active (used by retrieval fallback)
EXPLAIN QUERY PLAN
SELECT id, question, answer FROM faq
WHERE tenant_id = 'tenant_default' AND is_active = 1
ORDER BY priority DESC LIMIT 15;

-- 6) Hot path: bot_flows lookup
EXPLAIN QUERY PLAN
SELECT id, name, steps FROM bot_flows
WHERE tenant_id = 'tenant_default' AND name = 'sloten-main' AND is_active = 1;

-- 7) Tables WITHOUT a tenant_id index (multi-tenant isolation risk)
SELECT m.tbl_name AS table_name
FROM sqlite_master m
WHERE m.type = 'table'
  AND m.tbl_name NOT IN ('sqlite_sequence', 'sqlite_master', 'sqlite_temp_master', 'd1_migrations')
  AND EXISTS (
    SELECT 1 FROM pragma_table_info(m.tbl_name) WHERE name = 'tenant_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_master idx
    WHERE idx.type = 'index'
      AND idx.tbl_name = m.tbl_name
      AND idx.sql LIKE '%tenant_id%'
  );

-- 8) Row counts (helps decide if FTS5 / dense retrieval makes sense per table)
SELECT 'messages' AS tbl, COUNT(*) AS n FROM messages
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'ai_logs', COUNT(*) FROM ai_logs
UNION ALL SELECT 'faq', COUNT(*) FROM faq
UNION ALL SELECT 'knowledge_sources', COUNT(*) FROM knowledge_sources
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
UNION ALL SELECT 'attachments', COUNT(*) FROM attachments
ORDER BY n DESC;
