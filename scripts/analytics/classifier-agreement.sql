-- Classifier Shadow Agreement Rate
-- Compares the shadow-mode classifyIntent() result against what each
-- detector actually decided in the production flow. Use this to build
-- evidence for Step 2 migration (driving routing from classifier).
--
-- Step 2 GO criteria: agreement rate >= 95% sustained over 1 week,
-- with disagreement category breakdown reviewed.
--
-- Run:
--   npx wrangler d1 execute sloten_standalone_db_staging_bk \
--     --config wrangler.staging-bk.toml --remote --file=scripts/analytics/classifier-agreement.sql
--
-- Time window: last 24 hours. Adjust the WHERE clause for longer windows.

-- 1) Overall agreement rate
SELECT
  'overall' AS segment,
  COUNT(*) AS n,
  SUM(CASE WHEN classifier_primary = actual_path THEN 1 ELSE 0 END) AS agreed,
  ROUND(100.0 * SUM(CASE WHEN classifier_primary = actual_path THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS agreement_pct
FROM (
  SELECT
    json_extract(retrieval_trace, '$.classifier_result.primary') AS classifier_primary,
    CASE
      WHEN status = 'escalated'                                   THEN 'escalation'
      WHEN json_extract(retrieval_trace, '$.pachi_detected') = 1  THEN 'machine'
      WHEN json_extract(retrieval_trace, '$.announcement_detected') = 1 THEN 'announcement'
      WHEN status = 'threat_blocked'                              THEN 'threat'
      ELSE 'rag_default'
    END AS actual_path
  FROM ai_logs
  WHERE created_at >= datetime('now', '-1 day')
    AND retrieval_trace IS NOT NULL
);

-- 2) Disagreement breakdown by category — which intents are most often
--    misclassified?
SELECT
  classifier_primary,
  actual_path,
  COUNT(*) AS n
FROM (
  SELECT
    json_extract(retrieval_trace, '$.classifier_result.primary') AS classifier_primary,
    CASE
      WHEN status = 'escalated'                                   THEN 'escalation'
      WHEN json_extract(retrieval_trace, '$.pachi_detected') = 1  THEN 'machine'
      WHEN json_extract(retrieval_trace, '$.announcement_detected') = 1 THEN 'announcement'
      WHEN status = 'threat_blocked'                              THEN 'threat'
      ELSE 'rag_default'
    END AS actual_path
  FROM ai_logs
  WHERE created_at >= datetime('now', '-1 day')
    AND retrieval_trace IS NOT NULL
)
WHERE classifier_primary != actual_path
  AND classifier_primary IS NOT NULL
GROUP BY classifier_primary, actual_path
ORDER BY n DESC
LIMIT 20;

-- 3) Sample messages where classifier disagreed with actual routing
SELECT
  ai_logs.id,
  substr(input, 1, 80) AS msg_preview,
  json_extract(retrieval_trace, '$.classifier_result.primary') AS classifier_primary,
  CASE
    WHEN status = 'escalated' THEN 'escalation'
    WHEN json_extract(retrieval_trace, '$.pachi_detected') = 1 THEN 'machine'
    WHEN json_extract(retrieval_trace, '$.announcement_detected') = 1 THEN 'announcement'
    ELSE 'rag_default'
  END AS actual_path,
  status,
  created_at
FROM ai_logs
WHERE created_at >= datetime('now', '-1 day')
  AND retrieval_trace IS NOT NULL
  AND json_extract(retrieval_trace, '$.classifier_result.primary') !=
      CASE
        WHEN status = 'escalated' THEN 'escalation'
        WHEN json_extract(retrieval_trace, '$.pachi_detected') = 1 THEN 'machine'
        WHEN json_extract(retrieval_trace, '$.announcement_detected') = 1 THEN 'announcement'
        ELSE 'rag_default'
      END
ORDER BY created_at DESC
LIMIT 30;
