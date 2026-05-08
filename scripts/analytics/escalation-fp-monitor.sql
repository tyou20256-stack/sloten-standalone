-- Escalation False-Positive Rate Monitor
-- Tracks escalation patterns that fired in production. Use to detect
-- regex over-detection (e.g. polite queries getting escalated).
--
-- Run weekly, manually, or via cron-driven analytics worker.
-- Step 2: alert when FP rate > 2% (i.e. >2% of escalations look benign).
--
-- Run:
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/escalation-fp-monitor.sql

-- 1) Escalation rate trend (last 7 days, daily)
SELECT
  date(created_at) AS day,
  SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) AS escalated,
  COUNT(*) AS total,
  ROUND(100.0 * SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS rate_pct
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
GROUP BY day
ORDER BY day DESC;

-- 2) Top escalation reasons (last 24h)
SELECT
  COALESCE(escalation_reason, 'unknown') AS reason,
  COUNT(*) AS n,
  substr(GROUP_CONCAT(input, ' || '), 1, 500) AS sample_inputs
FROM ai_logs
WHERE status = 'escalated'
  AND created_at >= datetime('now', '-1 day')
GROUP BY reason
ORDER BY n DESC;

-- 3) FP candidate detector — escalations whose input is short / polite
-- looking. These warrant human review for regex tuning.
-- Heuristic: input < 30 chars AND contains polite particles.
SELECT
  id,
  input,
  escalation_reason,
  created_at
FROM ai_logs
WHERE status = 'escalated'
  AND created_at >= datetime('now', '-1 day')
  AND length(input) < 30
  AND (input LIKE '%教えて%' OR input LIKE '%について%' OR input LIKE '%お願い%'
       OR input LIKE '%いつ%'   OR input LIKE '%どこ%')
ORDER BY created_at DESC
LIMIT 20;

-- 4) Recent escalations on the new patterns added 2026-05-08
-- (frustration / numeric refund) — verify they continue firing correctly.
SELECT
  id,
  input,
  escalation_reason,
  created_at
FROM ai_logs
WHERE status = 'escalated'
  AND created_at >= datetime('now', '-7 days')
  AND (
    input LIKE '%解決し%' OR input LIKE '%対応し%' OR input LIKE '%放置%'
    OR (input LIKE '%円%' AND input LIKE '%返%')
  )
ORDER BY created_at DESC
LIMIT 15;
