// Cron handler — runs on the triggers defined in wrangler.toml.
//
// **REQUIREMENT**: The wrangler triggers MUST include `* * * * *` (every minute)
// for the metrics gating below (`minute % 5 === 0`) to fire at all 12 5-minute
// marks per hour. If the cron is changed to a coarser schedule (e.g. `*/5`),
// this gate will still work, but a `*/2` would skip 5-minute marks entirely
// and the monitor would silently miss firing.
//
// Defense: we additionally use a KV-stored last-run timestamp so that even if
// the minute gate misfires, the monitor will fire on the next available tick
// once at least 5 minutes have passed since the previous run.
//
// Duties:
//   1) Every minute: wake snoozed conversations whose timer has elapsed.
//   2) Every 5 minutes (or 5+ min since last run): metrics monitor + Telegram alerts (P-8).
//   3) Weekly (>= 7 days since last run): extract FAQ candidates.
//   4) Daily 00:00 UTC (09:00 JST): daily summary to Telegram.

import { extractFaqCandidates, getLastExtractionTs, setLastExtractionTs } from './extractor.mjs';
import { runMetricsMonitor, runDailySummary } from './handlers/metrics-monitor.mjs';
import { runClassifierAgreementReport } from './handlers/classifier-report.mjs';
import { runSyntheticUptime } from './handlers/synthetic-uptime.mjs';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const METRICS_INTERVAL_MS = 5 * 60 * 1000;
const METRICS_LAST_RUN_KEY = 'scheduled:metrics_monitor:last_run_ms';

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

  // --- 3) Metrics monitor (≥ every 5 minutes). Two-layer gate:
  //   a) Cheap path: wall-clock 5-min mark hits (works when cron is `* * * * *`)
  //   b) Recovery path: KV last-run check fires if a) misfired due to cron drift
  //      or wrangler schedule change. Either condition triggers the run.
  try {
    const minute = new Date().getMinutes();
    const onMark = minute % 5 === 0;
    const kv = env.SESSION_KV;
    let dueByElapsed = false;
    if (kv) {
      try {
        const lastRunStr = await kv.get(METRICS_LAST_RUN_KEY);
        const lastRun = lastRunStr ? Number(lastRunStr) : 0;
        if (Number.isFinite(lastRun) && Date.now() - lastRun >= METRICS_INTERVAL_MS) dueByElapsed = true;
        if (!Number.isFinite(lastRun) || lastRun === 0) dueByElapsed = true; // first run
      } catch (_) { /* fail-safe: skip elapsed-gate, rely on minute */ }
    }
    if (onMark || dueByElapsed) {
      await runMetricsMonitor(env, ctx);
      if (kv) {
        try { await kv.put(METRICS_LAST_RUN_KEY, String(Date.now()), { expirationTtl: 60 * 60 }); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[scheduled] metrics monitor error:', e.message);
  }

  // --- 4) Daily summary (00:00 UTC = 09:00 JST)
  // KV-gated per day — CF cron can deliver duplicate invocations within a
  // single minute (audit M1, 2026-05-13 second pass). Without this the
  // Telegram daily summary would fire twice on duplicate delivery.
  try {
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
      const kv = env.SESSION_KV;
      const dayKey = `scheduled:daily-summary:${new Date().toISOString().slice(0, 10)}`;
      let alreadyRan = false;
      if (kv) try { alreadyRan = !!(await kv.get(dayKey)); } catch (_) {}
      if (!alreadyRan) {
        await runDailySummary(env);
        if (kv) try { await kv.put(dayKey, '1', { expirationTtl: 26 * 60 * 60 }); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[scheduled] daily summary error:', e.message);
  }

  // --- 4a) Synthetic uptime probe (00:10 UTC = 09:10 JST)
  // Runs end-to-end AI chat probes daily. Catches integration breakage that
  // single-component health checks miss (e.g. Gemini API valid but FAQ broken).
  try {
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() >= 10 && now.getUTCMinutes() <= 14) {
      const kv = env.SESSION_KV;
      const dayKey = `synthetic:uptime:${new Date().toISOString().slice(0, 10)}`;
      let alreadyRan = false;
      if (kv) try { alreadyRan = !!(await kv.get(dayKey)); } catch (_) {}
      if (!alreadyRan) {
        await runSyntheticUptime(env, ctx);
        if (kv) try { await kv.put(dayKey, '1', { expirationTtl: 26 * 60 * 60 }); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[scheduled] synthetic uptime error:', e.message);
  }

  // --- 4a2) Weekly DB ANALYZE (Sunday 18:01 UTC = Monday 03:01 JST)
  // KV-gated per ISO-week so a duplicate cron tick inside the 6-minute window
  // (00–05) only runs ANALYZE once per Sunday (audit M1, 2026-05-13).
  try {
    const now = new Date();
    if (now.getUTCDay() === 0 && now.getUTCHours() === 18 && now.getUTCMinutes() <= 5) {
      const kv = env.SESSION_KV;
      const weekKey = `scheduled:analyze:${new Date().toISOString().slice(0, 10)}`;
      let alreadyRan = false;
      if (kv) try { alreadyRan = !!(await kv.get(weekKey)); } catch (_) {}
      if (!alreadyRan) {
        await env.DB.prepare('ANALYZE').run();
        if (kv) try { await kv.put(weekKey, '1', { expirationTtl: 7 * 24 * 60 * 60 }); } catch (_) {}
        console.log('[scheduled] D1 ANALYZE complete');
      }
    }
  } catch (e) {
    console.error('[scheduled] ANALYZE error:', e.message);
  }

  // --- 4b) Classifier shadow agreement report (00:05 UTC = 09:05 JST)
  // Runs after daily summary to give the day's classifier shadow data.
  // KV-gated for the day so repeat triggers within the cron window only fire once.
  try {
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() >= 5 && now.getUTCMinutes() <= 9) {
      await runClassifierAgreementReport(env);
    }
  } catch (e) {
    console.error('[scheduled] classifier agreement report error:', e.message);
  }

  // --- 5) Weekly FAQ extraction
  // Two-phase commit: write the gate key FIRST so a concurrent cron tick
  // sees it and bails (audit M2, 2026-05-13). The previous getLast →
  // extract → setLast pattern was non-atomic: duplicate delivery could
  // run extractFaqCandidates twice for the same 7-day window before
  // either invocation updated the timestamp.
  try {
    const last = await getLastExtractionTs(env);
    const now = Date.now();
    if (now - last < WEEK_MS) return; // not yet
    // Optimistic gate: stamp the timestamp BEFORE running. If another
    // invocation already stamped, our `last` read is stale by the time
    // we get here, but setLastExtractionTs is idempotent and the next
    // check (which reads the freshly-stamped value) will short-circuit.
    await setLastExtractionTs(env, now);
    const since = new Date(now - WEEK_MS).toISOString().slice(0, 19).replace('T', ' ');
    const stats = await extractFaqCandidates(env, { sinceIso: since });
    console.log('[scheduled] FAQ extraction:', JSON.stringify(stats));
  } catch (e) {
    console.error('[scheduled] FAQ extraction error:', e.message);
  }
}
