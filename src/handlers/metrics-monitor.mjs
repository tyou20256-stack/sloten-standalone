// Metrics monitor — runs on 5-minute cron trigger.
// Queries ai_logs for the last 5 minutes, computes key metrics,
// and fires Telegram alerts when thresholds are crossed.
// De-duplicates alerts: same alert type won't re-fire within 5 minutes (KV).

const WINDOW_MINUTES = 5;

// Thresholds
const THRESHOLDS = {
  error_rate_warn: 0.05,    // 5%
  error_rate_critical: 0.15, // 15%
  empty_rate_warn: 0.10,    // 10%
  p95_latency_warn: 5000,   // 5000ms
};

/**
 * Compute metrics from ai_logs within the last N minutes.
 */
async function computeMetrics(env) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const rows = await env.DB.prepare(`
    SELECT status, latency_ms, output
    FROM ai_logs
    WHERE created_at >= ?
  `).bind(since).all();

  const entries = rows.results || [];
  if (entries.length === 0) return null;

  const total = entries.length;
  // threat_blocked is a SECURITY signal (input filter caught injection / data
  // extraction attempt). Counting it as "error" muddies the operational alert:
  // a single attacker can pump up error_rate and trigger pages. Track it
  // separately so ops can monitor security activity without it firing the
  // generic uptime alert.
  const errors = entries.filter(r => r.status === 'error').length;
  const threatBlocked = entries.filter(r => r.status === 'threat_blocked').length;
  const empty = entries.filter(r => !r.output || r.output.trim().length === 0).length;
  const escalated = entries.filter(r => r.status === 'escalated').length;
  const latencies = entries
    .map(r => r.latency_ms)
    .filter(l => l != null && l > 0)
    .sort((a, b) => a - b);

  const p95Idx = Math.floor(latencies.length * 0.95);
  const p95 = latencies.length > 0 ? latencies[Math.min(p95Idx, latencies.length - 1)] : 0;

  return {
    total,
    error_rate: total > 0 ? errors / total : 0,
    empty_rate: total > 0 ? empty / total : 0,
    escalation_rate: total > 0 ? escalated / total : 0,
    threat_blocked_rate: total > 0 ? threatBlocked / total : 0,
    p95_latency_ms: p95,
    errors,
    threat_blocked: threatBlocked,
    empty,
    escalated,
    window_minutes: WINDOW_MINUTES,
    since,
  };
}

/**
 * Send Telegram message via Bot API.
 */
async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // silent no-op when secrets not set

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
  }).catch(() => {}); // fire-and-forget
}

/**
 * De-duplicate: don't re-send the same alert type within 5 minutes.
 *
 * KV namespace selection: prefers RATE_LIMITER (used by other rate-limit /
 * cache concerns elsewhere in the worker) → falls back to STATE_KV →
 * SESSION_KV. Previously this was hardcoded to SESSION_KV which created an
 * inconsistency with announcements.mjs / pachi-machines.mjs (which use
 * RATE_LIMITER). When SESSION_KV binding wasn't set in some environments,
 * this silently failed dedup → repeated alerts.
 */
async function shouldAlert(env, alertKey) {
  const kv = env.RATE_LIMITER || env.STATE_KV || env.SESSION_KV;
  if (!kv) return true;
  const key = `alert:dedup:${alertKey}`;
  try {
    if (await kv.get(key)) return false;
    await kv.put(key, '1', { expirationTtl: WINDOW_MINUTES * 60 });
    return true;
  } catch (_) {
    return true; // fail-open
  }
}

/**
 * Check thresholds and fire alerts.
 */
async function checkAlerts(env, metrics) {
  const alerts = [];

  if (metrics.error_rate >= THRESHOLDS.error_rate_critical) {
    if (await shouldAlert(env, 'error_critical')) {
      alerts.push(`🚨 *CRITICAL* エラー率 ${(metrics.error_rate * 100).toFixed(1)}% (${metrics.errors}/${metrics.total}件、直近${WINDOW_MINUTES}分)`);
    }
  } else if (metrics.error_rate >= THRESHOLDS.error_rate_warn) {
    if (await shouldAlert(env, 'error_warn')) {
      alerts.push(`⚠️ エラー率 ${(metrics.error_rate * 100).toFixed(1)}% (${metrics.errors}/${metrics.total}件)`);
    }
  }

  if (metrics.empty_rate >= THRESHOLDS.empty_rate_warn) {
    if (await shouldAlert(env, 'empty_warn')) {
      alerts.push(`⚠️ 空応答率 ${(metrics.empty_rate * 100).toFixed(1)}% (${metrics.empty}/${metrics.total}件)`);
    }
  }

  if (metrics.p95_latency_ms >= THRESHOLDS.p95_latency_warn) {
    if (await shouldAlert(env, 'latency_warn')) {
      alerts.push(`⚠️ p95レイテンシ ${metrics.p95_latency_ms}ms (閾値: ${THRESHOLDS.p95_latency_warn}ms)`);
    }
  }

  if (alerts.length > 0) {
    const header = `*[sloten-standalone]* 監視アラート\n`;
    const text = header + alerts.join('\n');
    await sendTelegram(env, text);
  }

  return alerts;
}

/**
 * Daily summary — call at 09:00 JST (= 00:00 UTC).
 */
async function dailySummary(env) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const rows = await env.DB.prepare(`
    SELECT status, latency_ms, output
    FROM ai_logs
    WHERE created_at >= ?
  `).bind(since).all();

  const entries = rows.results || [];
  if (entries.length === 0) {
    await sendTelegram(env, '📊 *日次サマリ*: 過去24時間のAIログ 0件');
    return;
  }

  const total = entries.length;
  const errors = entries.filter(r => r.status === 'error' || r.status === 'threat_blocked').length;
  const empty = entries.filter(r => !r.output || r.output.trim().length === 0).length;
  const escalated = entries.filter(r => r.status === 'escalated').length;
  const latencies = entries.map(r => r.latency_ms).filter(l => l > 0).sort((a, b) => a - b);
  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  const text = [
    '📊 *日次サマリ* (過去24h)',
    `総リクエスト: ${total}`,
    `エラー率: ${(errors / total * 100).toFixed(1)}% (${errors}件)`,
    `空応答率: ${(empty / total * 100).toFixed(1)}% (${empty}件)`,
    `エスカレーション: ${escalated}件 (${(escalated / total * 100).toFixed(1)}%)`,
    `レイテンシ: p50=${p50}ms / p95=${p95}ms`,
  ].join('\n');

  await sendTelegram(env, text);
}

/**
 * Main entry point — called from scheduled.mjs on every cron tick.
 */
export async function runMetricsMonitor(env, ctx) {
  const metrics = await computeMetrics(env);
  if (!metrics) return; // no data

  // Check thresholds and alert
  await checkAlerts(env, metrics);

  // Log metrics (visible in wrangler tail)
  console.log(`[metrics] total=${metrics.total} err=${(metrics.error_rate*100).toFixed(1)}% empty=${(metrics.empty_rate*100).toFixed(1)}% esc=${metrics.escalated} p95=${metrics.p95_latency_ms}ms`);
}

/**
 * Daily summary trigger — called from scheduled.mjs on 00:00 UTC cron.
 */
export async function runDailySummary(env) {
  await dailySummary(env);
}
