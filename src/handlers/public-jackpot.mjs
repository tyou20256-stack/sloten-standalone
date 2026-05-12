// Public jackpot endpoint — fetches the live dream-pot amount from sloten.io,
// caches in KV with stale-while-revalidate, falls back to DB then default.
//
// fix: avoid p99 spike when CACHE_TTL expired (was avg 466ms / p99 1284ms).
// Strategy: serve from cache for up to STALE_TTL (5 min). When cache is older
// than FRESH_TTL (60 s) but within STALE_TTL, return immediately AND kick off
// a background refresh via ctx.waitUntil. Live fetch never blocks the user.
//
// Response: { success: true, amount: <integer JPY>, currency: 'JPY',
//             source: 'kv-cache' | 'kv-stale-revalidating' | 'sloten-live' |
//                     'db-fallback' | 'default' }

import { ok } from '../json.mjs';
import { bestEffortSync } from '../lib/best-effort.mjs';

const LIVE_URL = 'https://sloten.io/api/jackpot/campaign/current';
const CACHE_KEY = 'public:jackpot:v2'; // bump key to invalidate v1 (string-only) entries
const FRESH_TTL = 60;   // seconds — return cached without revalidation
const STALE_TTL = 300;  // seconds — return cached + revalidate in background
const DEFAULT_AMOUNT = 5000000;

function extractAmount(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Try several likely shapes.
  const candidates = [
    obj?.amount,
    obj?.value,
    obj?.poolAmount,
    obj?.currentCampaign?.poolAmount,
    obj?.currentCampaign?.amount,
    obj?.data?.amount,
    obj?.data?.value,
    obj?.data?.campaign?.amount,
    obj?.campaign?.amount,
    obj?.dreampot?.amount,
    obj?.result?.amount,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// Background refresh task: fetch live, write KV + DB. Used by both the
// initial fill (no cache) and the stale-while-revalidate path.
async function refreshJackpot(env) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(LIVE_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'sloten-standalone/1.0' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    const n = extractAmount(data);
    if (!n) return null;
    const entry = JSON.stringify({ n, ts: Math.floor(Date.now() / 1000) });
    try {
      if (env.RATE_LIMITER) await env.RATE_LIMITER.put(CACHE_KEY, entry, { expirationTtl: STALE_TTL });
    } catch (_) {}
    try {
      if (env.DB) {
        await env.DB.prepare(
          `INSERT INTO feature_flags (key, value, updated_at) VALUES ('jackpot_amount', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).bind(String(n)).run();
      }
    } catch (_) {}
    return n;
  } catch (e) {
    console.warn('[public-jackpot] live fetch failed:', e.message);
    return null;
  }
}

export async function getPublicJackpot(request, env, corsHeaders, ctx) {
  // 1) Try KV — return immediately if any cached value, revalidate if stale.
  try {
    if (env.RATE_LIMITER) {
      const cached = await env.RATE_LIMITER.get(CACHE_KEY);
      if (cached) {
        const entry = bestEffortSync('public-jackpot:parse-cached', () => JSON.parse(cached))
          || { n: parseInt(cached, 10), ts: 0 };
        const n = entry?.n;
        const ts = entry?.ts || 0;
        const ageS = Math.max(0, Math.floor(Date.now() / 1000) - ts);
        if (Number.isFinite(n) && n > 0) {
          if (ageS > FRESH_TTL && ctx && typeof ctx.waitUntil === 'function') {
            // Stale — kick off background refresh, return cached now.
            ctx.waitUntil(refreshJackpot(env));
            return ok({ success: true, amount: n, currency: 'JPY', source: 'kv-stale-revalidating' }, corsHeaders);
          }
          return ok({ success: true, amount: n, currency: 'JPY', source: 'kv-cache' }, corsHeaders);
        }
      }
    }
  } catch (_) { /* ignore KV errors */ }

  // 2) No cache — must fetch synchronously this once. Subsequent requests
  //    hit the cache. Even on cold path, write entry with timestamp.
  const n = await refreshJackpot(env);
  if (n) return ok({ success: true, amount: n, currency: 'JPY', source: 'sloten-live' }, corsHeaders);

  // 3) DB fallback
  try {
    if (env.DB) {
      const row = await env.DB.prepare(`SELECT value FROM feature_flags WHERE key = 'jackpot_amount'`).first();
      const dbN = row?.value ? parseInt(row.value, 10) : NaN;
      if (Number.isFinite(dbN) && dbN > 0) {
        return ok({ success: true, amount: dbN, currency: 'JPY', source: 'db-fallback' }, corsHeaders);
      }
    }
  } catch (_) {}

  // 4) Hard default
  return ok({ success: true, amount: DEFAULT_AMOUNT, currency: 'JPY', source: 'default' }, corsHeaders);
}
