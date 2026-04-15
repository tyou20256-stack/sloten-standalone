// Cron handler — runs on the triggers defined in wrangler.toml.
// Duties:
//   1) Every minute: wake snoozed conversations whose timer has elapsed.
//   2) Weekly (>= 7 days since last run): extract FAQ candidates from the
//      last 7 days of customer↔staff Q&A and upsert into faq_candidates
//      (status=pending) for admin review.

import { extractFaqCandidates, getLastExtractionTs, setLastExtractionTs } from './extractor.mjs';

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

  // --- 2) Weekly FAQ extraction
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
