-- Error log trends — surface where the worker is failing.
--
-- Run weekly. Look for spikes in specific source modules indicating new
-- regressions; spikes in 'flow:webhook' once webhooks are wired.
--
-- Run:
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/error-trends.sql

-- 1) Errors by source module (last 7 days)
SELECT
  source,
  COUNT(*) AS n,
  COUNT(DISTINCT date(created_at)) AS active_days,
  MIN(created_at) AS first_seen,
  MAX(created_at) AS last_seen
FROM error_log
WHERE created_at >= datetime('now', '-7 days')
GROUP BY source
ORDER BY n DESC;

-- 2) Top error messages (deduplicated by first 80 chars)
SELECT
  source,
  substr(message, 1, 80) AS msg_preview,
  COUNT(*) AS n,
  MAX(created_at) AS last_seen
FROM error_log
WHERE created_at >= datetime('now', '-7 days')
GROUP BY source, substr(message, 1, 80)
ORDER BY n DESC
LIMIT 20;

-- 3) Daily error rate trend
SELECT
  date(created_at) AS day,
  COUNT(*) AS n,
  COUNT(DISTINCT source) AS distinct_sources
FROM error_log
WHERE created_at >= datetime('now', '-30 days')
GROUP BY day
ORDER BY day DESC;

-- 4) Errors that haven't been seen in over 7 days (regression candidates if
-- a source had errors but stopped — could mean the bug was fixed OR the
-- code path is no longer reachable)
SELECT source, COUNT(*) AS total, MAX(created_at) AS last_seen
FROM error_log
GROUP BY source
HAVING last_seen < datetime('now', '-7 days')
   AND total > 5
ORDER BY total DESC
LIMIT 10;

-- 5) Cross-reference with ai_logs to see if errors correlate with empty AI
-- responses (i.e. a regression in a code path causing both)
SELECT
  date(e.created_at) AS day,
  e.source,
  COUNT(DISTINCT e.id) AS errors,
  (SELECT COUNT(*) FROM ai_logs WHERE date(created_at) = day AND status = 'empty') AS ai_empty,
  (SELECT COUNT(*) FROM ai_logs WHERE date(created_at) = day AND status = 'error') AS ai_error
FROM error_log e
WHERE e.created_at >= datetime('now', '-7 days')
GROUP BY day, e.source
HAVING errors >= 3
ORDER BY day DESC, errors DESC
LIMIT 20;
