// Cron handler — runs on the triggers defined in wrangler.toml.
// Duties:
//   1) Every minute: wake snoozed conversations whose timer has elapsed.
//   2) Every 5 minutes: metrics monitor + Telegram alerts (P-8).
//   3) Weekly (>= 7 days since last run): extract FAQ candidates.
//   4) Daily 00:00 UTC (09:00 JST): daily summary to Telegram.

import { extractFaqCandidates, getLastExtractionTs, setLastExtractionTs } from './extractor.mjs';
import { runMetricsMonitor, runDailySummary } from './handlers/metrics-monitor.mjs';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function handleScheduled(event, env, ctx) {
  // --- 1) Wake snoozed conversations
  try {
    const res = await env.DB.prepare(
      `UPDATE conversations
          SET snoozed_until = NULL,
              updated_at = datetime('now')
        WHERE snoozed_until IS NOT NULL
          AND snoozed_until <= datetime('now')`
    ).run();
    if (res.meta?.changes) {
      console.log(`[scheduled] woke ${res.meta.changes} snoozed conversations`);
    }
  } catch (e) {
    console.error('[scheduled] snooze wake error:', e.message);
  }

  // --- 2) Log rotation — purge audit_log & error_log entries older than 90 days.
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const a = await env.DB.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(cutoff).run();
    const e = await env.DB.prepare('DELETE FROM error_log WHERE created_at < ?').bind(cutoff).run();
    const total = (a.meta?.changes || 0) + (e.meta?.changes || 0);
    if (total) console.log(`[scheduled] purged ${total} old log entries (>90d)`);
  } catch (e) {
    console.error('[scheduled] log rotation error:', e.message);
  }

  // --- 3) Metrics monitor (every 5 minutes)
  try {
    const minute = new Date().getMinutes();
    if (minute % 5 === 0) {
      await runMetricsMonitor(env, ctx);
    }
  } catch (e) {
    console.error('[scheduled] metrics monitor error:', e.message);
  }

  // --- 4) Daily summary (00:00 UTC = 09:00 JST)
  try {
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
      await runDailySummary(env);
    }
  } catch (e) {
    console.error('[scheduled] daily summary error:', e.message);
  }

  // --- 5) Weekly FAQ extraction
  try {
    const last = await getLastExtractionTs(env);
    const now = Date.now();
    if (now - last < WEEK_MS) return; // not yet
    // Last-7-days scan:
    const since = new Date(now - WEEK_MS).toISOString().slice(0, 19).replace('T', ' ');
    const stats = await extractFaqCandidates(env, { sinceIso: since });
    await setLastExtractionTs(env, now);
    console.log('[scheduled] FAQ extraction:', JSON.stringify(stats));
  } catch (e) {
    console.error('[scheduled] FAQ extraction error:', e.message);
  }
}
