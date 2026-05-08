// Classifier shadow-mode agreement reporter.
//
// Runs daily (cron 00:05 UTC = 09:05 JST, after daily summary). Queries
// the last 24h of ai_logs.retrieval_trace and computes:
//   - Overall agreement rate between classifyIntent.primary (shadow)
//     and the actual routing path that fired.
//   - Top disagreement pairs (where they differ).
//
// Surfaces the result as a Telegram message and (optionally) writes a
// summary to KV for later HTTP retrieval. Step 2 migration GO criteria:
// agreement >= 95% sustained for 7 consecutive daily reports.

const ACTUAL_PATH_CASE = `
  CASE
    WHEN status = 'escalated' THEN 'escalation'
    WHEN json_extract(retrieval_trace, '$.pachi_detected') = 1 THEN 'machine'
    WHEN json_extract(retrieval_trace, '$.announcement_detected') = 1 THEN 'announcement'
    WHEN status = 'threat_blocked' THEN 'threat'
    ELSE 'rag_default'
  END
`;

async function fetchAgreementMetrics(env) {
  const sql = `
    WITH classified AS (
      SELECT
        json_extract(retrieval_trace, '$.classifier_result.primary') AS classifier_primary,
        ${ACTUAL_PATH_CASE} AS actual_path
      FROM ai_logs
      WHERE created_at >= datetime('now', '-1 day')
        AND retrieval_trace IS NOT NULL
        AND json_extract(retrieval_trace, '$.classifier_result.primary') IS NOT NULL
    )
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN classifier_primary = actual_path THEN 1 ELSE 0 END) AS agreed
    FROM classified
  `;
  const row = await env.DB.prepare(sql).first();
  return {
    n: row?.n || 0,
    agreed: row?.agreed || 0,
    rate: row?.n > 0 ? row.agreed / row.n : null,
  };
}

async function fetchTopDisagreements(env, limit = 5) {
  const sql = `
    WITH classified AS (
      SELECT
        json_extract(retrieval_trace, '$.classifier_result.primary') AS classifier_primary,
        ${ACTUAL_PATH_CASE} AS actual_path
      FROM ai_logs
      WHERE created_at >= datetime('now', '-1 day')
        AND retrieval_trace IS NOT NULL
        AND json_extract(retrieval_trace, '$.classifier_result.primary') IS NOT NULL
    )
    SELECT classifier_primary, actual_path, COUNT(*) AS n
    FROM classified
    WHERE classifier_primary != actual_path
    GROUP BY classifier_primary, actual_path
    ORDER BY n DESC
    LIMIT ?
  `;
  const r = await env.DB.prepare(sql).bind(limit).all();
  return r.results || [];
}

async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

/**
 * Run daily classifier agreement report. Idempotent — KV-gated for the day
 * so multiple cron triggers within the daily run window only send once.
 */
export async function runClassifierAgreementReport(env) {
  const kv = env.RATE_LIMITER || env.STATE_KV || env.SESSION_KV;
  const dayKey = `classifier:report:${new Date().toISOString().slice(0, 10)}`;
  if (kv) {
    try {
      if (await kv.get(dayKey)) return { skipped: 'already_sent_today' };
    } catch (_) {}
  }

  const metrics = await fetchAgreementMetrics(env);
  if (metrics.n === 0) {
    return { skipped: 'no_data' };
  }

  const disagreements = await fetchTopDisagreements(env);
  const ratePct = (metrics.rate * 100).toFixed(1);
  const rateBadge = metrics.rate >= 0.95 ? '🟢' :
                    metrics.rate >= 0.85 ? '🟡' : '🔴';

  let text = `*Classifier Shadow Report* (last 24h)\n`;
  text += `${rateBadge} Agreement: ${metrics.agreed} / ${metrics.n} = *${ratePct}%*\n`;
  text += `Threshold: 95% (Step 2 migration ready)\n\n`;

  if (disagreements.length > 0) {
    text += `*Top disagreements:*\n`;
    for (const d of disagreements) {
      text += `• \`${d.classifier_primary}\` → \`${d.actual_path}\`: ${d.n}\n`;
    }
  } else {
    text += `_No disagreements — perfect agreement._\n`;
  }

  await sendTelegram(env, text);

  if (kv) {
    try {
      // Cache the report for the day so duplicate triggers don't re-send.
      await kv.put(dayKey, JSON.stringify({ ratePct, n: metrics.n, ts: Date.now() }), {
        expirationTtl: 26 * 60 * 60, // 26h to cover cron drift
      });
    } catch (_) {}
  }

  console.log(`[classifier-report] ${ratePct}% agreement (${metrics.agreed}/${metrics.n})`);
  return { rate: metrics.rate, n: metrics.n, disagreements };
}
