-- Token budget per conversation — cost monitoring + abuse detection.
--
-- Run weekly. High-cost conversations (>50k tokens) may indicate:
--   - Looping/stuck flows
--   - Adversarial users sending huge prompts
--   - Very long support sessions worth investigating
--
-- Run:
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/token-budget.sql

-- 1) Token cost by conversation (last 7 days)
SELECT
  conversation_id,
  COUNT(*) AS llm_calls,
  SUM(tokens_in) AS total_in,
  SUM(tokens_out) AS total_out,
  SUM(tokens_in + tokens_out) AS total_tokens,
  ROUND(AVG(latency_ms)) AS avg_latency_ms
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
  AND tokens_in IS NOT NULL
GROUP BY conversation_id
ORDER BY total_tokens DESC
LIMIT 20;

-- 2) Daily token totals (cost trend)
SELECT
  date(created_at) AS day,
  COUNT(*) AS calls,
  SUM(tokens_in) AS total_in,
  SUM(tokens_out) AS total_out,
  SUM(tokens_in + tokens_out) AS total_tokens,
  -- Gemini Flash Lite pricing (May 2026):
  --   $0.10 / M input tokens, $0.40 / M output tokens
  -- Adjust if pricing changes; this is informational only.
  ROUND((SUM(tokens_in) * 0.10 + SUM(tokens_out) * 0.40) / 1000000.0, 4) AS est_usd
FROM ai_logs
WHERE created_at >= datetime('now', '-30 days')
  AND tokens_in IS NOT NULL
  AND provider = 'gemini'
GROUP BY day
ORDER BY day DESC;

-- 3) Tenant-level cost breakdown (multi-tenant cost allocation)
SELECT
  tenant_id,
  COUNT(*) AS calls,
  SUM(tokens_in) AS total_in,
  SUM(tokens_out) AS total_out
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
  AND tokens_in IS NOT NULL
GROUP BY tenant_id
ORDER BY (total_in + total_out) DESC;

-- 4) Cache hit rate over 7 days (savings indicator)
SELECT
  date(created_at) AS day,
  SUM(CASE WHEN provider = 'cache' THEN 1 ELSE 0 END) AS cache_hits,
  SUM(CASE WHEN provider IN ('gemini', 'anthropic') THEN 1 ELSE 0 END) AS llm_calls,
  ROUND(100.0 * SUM(CASE WHEN provider = 'cache' THEN 1 ELSE 0 END) /
        NULLIF(SUM(CASE WHEN provider IN ('cache', 'gemini', 'anthropic') THEN 1 ELSE 0 END), 0), 1) AS cache_hit_pct
FROM ai_logs
WHERE created_at >= datetime('now', '-7 days')
GROUP BY day
ORDER BY day DESC;
