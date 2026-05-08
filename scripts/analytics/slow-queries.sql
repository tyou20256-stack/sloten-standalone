-- D1 slow query / hot path analytics
--
-- Run weekly to spot performance regressions before they hit users.
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/slow-queries.sql

-- 1) ai_logs latency distribution (last 7 days)
SELECT
  CASE
    WHEN latency_ms < 1000 THEN '< 1s'
    WHEN latency_ms < 3000 THEN '1-3s'
    WHEN latency_ms < 5000 THEN '3-5s'
    WHEN latency_ms < 10000 THEN '5-10s'
    WHEN latency_ms < 20000 THEN '10-20s'
    ELSE '20s+'
  END AS bucket,
  COUNT(*) AS n,
  ROUND(AVG(latency_ms)) AS avg_ms,
  status
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
  AND latency_ms IS NOT NULL
GROUP BY bucket, status
ORDER BY
  CASE bucket
    WHEN '< 1s' THEN 1 WHEN '1-3s' THEN 2 WHEN '3-5s' THEN 3
    WHEN '5-10s' THEN 4 WHEN '10-20s' THEN 5 ELSE 6
  END,
  status;

-- 2) Top 10 slowest queries last 24h with input preview
SELECT
  id,
  substr(input, 1, 60) AS input_preview,
  latency_ms,
  status,
  json_extract(retrieval_trace, '$.finish_reason') AS finish_reason,
  json_extract(retrieval_trace, '$.retried') AS retried,
  created_at
FROM ai_logs
WHERE created_at >= datetime('now', '-1 day')
  AND latency_ms IS NOT NULL
ORDER BY latency_ms DESC
LIMIT 10;

-- 3) Cache hit rate (genai response cache effectiveness)
-- After Phase B caching deploy, expect provider='cache' rate to grow over
-- time as repeat queries accumulate.
SELECT
  date(created_at) AS day,
  SUM(CASE WHEN provider = 'cache' THEN 1 ELSE 0 END) AS cache_hits,
  SUM(CASE WHEN provider = 'gemini' THEN 1 ELSE 0 END) AS gemini_calls,
  ROUND(100.0 * SUM(CASE WHEN provider = 'cache' THEN 1 ELSE 0 END) /
        NULLIF(SUM(CASE WHEN provider IN ('cache', 'gemini') THEN 1 ELSE 0 END), 0), 1) AS cache_hit_pct
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
GROUP BY day
ORDER BY day DESC;

-- 4) Conversations table hot path — find conversations with rapid message bursts
SELECT
  conversation_id,
  COUNT(*) AS msg_count,
  MIN(created_at) AS first_msg,
  MAX(created_at) AS last_msg,
  ROUND((julianday(MAX(created_at)) - julianday(MIN(created_at))) * 86400) AS span_sec
FROM messages
WHERE created_at >= datetime('now', '-1 day')
GROUP BY conversation_id
HAVING msg_count >= 20 AND span_sec < 600
ORDER BY msg_count DESC
LIMIT 10;

-- 5) Token usage summary (last 24h) — cost monitoring
SELECT
  date(created_at) AS day,
  COUNT(*) AS calls,
  SUM(tokens_in) AS total_in,
  SUM(tokens_out) AS total_out,
  ROUND(AVG(tokens_in)) AS avg_in,
  ROUND(AVG(tokens_out)) AS avg_out
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
  AND tokens_in IS NOT NULL
GROUP BY day
ORDER BY day DESC;
