-- Audit log review queries — run weekly to surface unusual staff activity
--
-- Run:
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/audit-review.sql

-- 1) Action volume by staff (last 7 days)
SELECT
  staff_id,
  staff_email,
  action,
  COUNT(*) AS n
FROM audit_log
WHERE created_at >= datetime('now', '-7 days')
GROUP BY staff_id, action
ORDER BY n DESC
LIMIT 30;

-- 2) Sensitive actions — anyone deleting data?
SELECT
  staff_email,
  action,
  resource_type,
  resource_id,
  created_at,
  ip
FROM audit_log
WHERE action IN ('DELETE', 'PURGE', 'BULK_DELETE')
  AND created_at >= datetime('now', '-7 days')
ORDER BY created_at DESC
LIMIT 30;

-- 3) Unusual hours — staff actions outside 06:00-22:00 JST (= 21:00-13:00 UTC)
-- Adjust if business hours differ.
SELECT
  staff_email,
  action,
  resource_type,
  CAST(strftime('%H', created_at) AS INT) AS hour_utc,
  COUNT(*) AS n
FROM audit_log
WHERE created_at >= datetime('now', '-7 days')
  AND (CAST(strftime('%H', created_at) AS INT) < 21
       AND CAST(strftime('%H', created_at) AS INT) > 13)
GROUP BY staff_email, action, hour_utc
ORDER BY n DESC
LIMIT 20;

-- 4) Recent errors with IP (potential attack indicators)
SELECT
  source,
  substr(message, 1, 100) AS msg,
  COUNT(*) AS n,
  MAX(created_at) AS latest
FROM error_log
WHERE created_at >= datetime('now', '-1 day')
GROUP BY source, substr(message, 1, 100)
ORDER BY n DESC
LIMIT 20;

-- 5) Threat detection telemetry — anyone trying injection attacks?
SELECT
  date(created_at) AS day,
  json_extract(retrieval_trace, '$.threat_category') AS category,
  COUNT(*) AS n
FROM ai_logs
WHERE status = 'threat_blocked'
  AND created_at >= datetime('now', '-30 days')
GROUP BY day, category
ORDER BY day DESC, n DESC;

-- 6) Failed login bursts — same email from multiple IPs in 1h
SELECT
  staff_email,
  COUNT(DISTINCT ip) AS distinct_ips,
  COUNT(*) AS attempts,
  MIN(created_at) AS first_try,
  MAX(created_at) AS last_try
FROM audit_log
WHERE action = 'LOGIN_FAILED'
  AND created_at >= datetime('now', '-1 day')
GROUP BY staff_email
HAVING distinct_ips >= 2 OR attempts >= 5
ORDER BY attempts DESC
LIMIT 10;
