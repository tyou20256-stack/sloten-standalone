// Cron handler — runs on the triggers defined in wrangler.toml.
// Current duties:
//   - Wake snoozed conversations: clear snoozed_until when it has passed.
//     (status is not modified; snooze is purely a "hidden from the list
//     until X" overlay that list filters respect.)

export async function handleScheduled(event, env, ctx) {
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
    console.error('[scheduled] error:', e.message);
  }
}
