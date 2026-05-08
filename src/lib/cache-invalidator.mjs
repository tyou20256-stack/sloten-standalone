// Cache invalidation helper — call from admin handlers after mutations
// that affect AI responses (FAQ edits, KB edits, ai_prompts changes).
//
// Strategy: best-effort, fire-and-forget. Failure to flush is logged but
// never blocks the underlying mutation. Cache will self-heal at TTL anyway.

const PREFIX = 'genai:cache:';

/**
 * Flush all genai response cache entries. Use after any change that could
 * make cached AI responses stale: FAQ edit, KB edit, prompt config change.
 *
 * @param {object} env — Worker env (must have RATE_LIMITER or STATE_KV)
 * @param {object} ctx — Worker context for waitUntil (optional)
 * @returns {Promise<{deleted: number} | {skipped: string}>}
 */
export async function invalidateGenaiCache(env, ctx) {
  const kv = env.RATE_LIMITER || env.STATE_KV;
  if (!kv) return { skipped: 'no_kv' };
  const op = (async () => {
    try {
      let cursor = null;
      let deleted = 0;
      do {
        const r = await kv.list({ prefix: PREFIX, cursor, limit: 1000 });
        for (const k of r.keys) {
          try { await kv.delete(k.name); deleted++; } catch (_) {}
        }
        cursor = r.list_complete ? null : r.cursor;
        if (deleted > 5000) break; // safety cap
      } while (cursor);
      console.log(`[cache-invalidator] flushed ${deleted} genai entries`);
      return deleted;
    } catch (e) {
      console.warn('[cache-invalidator] flush failed:', e.message);
      return -1;
    }
  })();
  if (ctx?.waitUntil) {
    ctx.waitUntil(op);
    return { scheduled: true };
  }
  const deleted = await op;
  return { deleted };
}
