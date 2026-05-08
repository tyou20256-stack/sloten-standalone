// Admin cache invalidation endpoints. Use to flush KV-cached responses
// after admin actions (FAQ edits, announcement updates, machine DB sync)
// so users see fresh data immediately rather than waiting for TTL expiry.
//
// Routes (registered in src/index.mjs):
//   POST /api/admin/cache/flush       — flush all genai response cache
//   POST /api/admin/cache/flush-faq   — flush genai cache + announcements:v1
//   GET  /api/admin/cache/stats       — count entries by prefix

import { ok, err } from '../json.mjs';

const PREFIXES = {
  genai: 'genai:cache:',
  announcements: 'announcements:v1',
  pachi_exists: 'pachi:exists:',
};

async function listKvKeys(kv, prefix, max = 1000) {
  const all = [];
  let cursor = null;
  do {
    const r = await kv.list({ prefix, cursor, limit: 1000 });
    all.push(...r.keys.map((k) => k.name));
    cursor = r.list_complete ? null : r.cursor;
    if (all.length >= max) break;
  } while (cursor);
  return all;
}

async function deleteKvByPrefix(kv, prefix) {
  const keys = await listKvKeys(kv, prefix);
  let deleted = 0;
  for (const k of keys) {
    try { await kv.delete(k); deleted++; } catch (_) {}
  }
  return { deleted, listed: keys.length };
}

/** POST /api/admin/cache/flush — flush all genai response cache */
export async function flushGenaiCache(_request, env, corsHeaders) {
  const kv = env.RATE_LIMITER || env.STATE_KV;
  if (!kv) return err('No KV namespace bound', 503, corsHeaders);
  const r = await deleteKvByPrefix(kv, PREFIXES.genai);
  return ok({ success: true, ...r, prefix: PREFIXES.genai }, corsHeaders);
}

/**
 * POST /api/admin/cache/flush-faq — flush genai response cache AND
 * announcements cache. Call after FAQ DB edits or announcement publishing.
 */
export async function flushFaqCache(_request, env, corsHeaders) {
  const kv = env.RATE_LIMITER || env.STATE_KV;
  if (!kv) return err('No KV namespace bound', 503, corsHeaders);
  const genai = await deleteKvByPrefix(kv, PREFIXES.genai);
  // announcements:v1 is a single key, not a prefix
  let announcementsDeleted = 0;
  try {
    await kv.delete('announcements:v1');
    announcementsDeleted = 1;
  } catch (_) {}
  return ok({
    success: true,
    genai,
    announcements: { deleted: announcementsDeleted },
  }, corsHeaders);
}

/** GET /api/admin/cache/stats — count entries by prefix */
export async function cacheStats(_request, env, corsHeaders) {
  const kv = env.RATE_LIMITER || env.STATE_KV;
  if (!kv) return err('No KV namespace bound', 503, corsHeaders);
  const result = {};
  for (const [name, prefix] of Object.entries(PREFIXES)) {
    if (prefix === 'announcements:v1') {
      // single key — check existence
      const v = await kv.get(prefix);
      result[name] = { exists: v !== null, prefix };
    } else {
      const keys = await listKvKeys(kv, prefix, 5000);
      result[name] = { count: keys.length, prefix };
    }
  }
  return ok({ success: true, stats: result }, corsHeaders);
}
