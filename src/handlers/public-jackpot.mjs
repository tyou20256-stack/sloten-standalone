// Public jackpot endpoint — fetches the live dream-pot amount from sloten.io,
// caches in KV (60s), falls back to DB feature_flag value, then a hard default.
//
// Response: { success: true, amount: <integer JPY>, currency: 'JPY',
//             source: 'kv-cache' | 'sloten-live' | 'db-fallback' | 'default' }

import { ok } from '../json.mjs';

const LIVE_URL = 'https://sloten.io/api/jackpot/campaign/current';
const CACHE_KEY = 'public:jackpot:current';
const CACHE_TTL = 60; // seconds
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

export async function getPublicJackpot(request, env, corsHeaders) {
  // 1) Try KV cache first
  try {
    if (env.RATE_LIMITER) {
      const cached = await env.RATE_LIMITER.get(CACHE_KEY);
      if (cached) {
        const n = parseInt(cached, 10);
        if (Number.isFinite(n) && n > 0) {
          return ok({ success: true, amount: n, currency: 'JPY', source: 'kv-cache' }, corsHeaders);
        }
      }
    }
  } catch (_) { /* ignore KV errors */ }

  // 2) Fetch live from sloten.io
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(LIVE_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'sloten-standalone/1.0' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (r.ok) {
      const data = await r.json();
      const n = extractAmount(data);
      if (n) {
        // Persist both to KV (fast path) and DB (fallback path).
        try { if (env.RATE_LIMITER) await env.RATE_LIMITER.put(CACHE_KEY, String(n), { expirationTtl: CACHE_TTL }); } catch (_) {}
        try {
          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO feature_flags (key, value, updated_at) VALUES ('jackpot_amount', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
            ).bind(String(n)).run();
          }
        } catch (_) {}
        return ok({ success: true, amount: n, currency: 'JPY', source: 'sloten-live' }, corsHeaders);
      }
    }
  } catch (e) {
    console.warn('[public-jackpot] live fetch failed:', e.message);
  }

  // 3) DB fallback
  try {
    if (env.DB) {
      const row = await env.DB.prepare(`SELECT value FROM feature_flags WHERE key = 'jackpot_amount'`).first();
      const n = row?.value ? parseInt(row.value, 10) : NaN;
      if (Number.isFinite(n) && n > 0) {
        return ok({ success: true, amount: n, currency: 'JPY', source: 'db-fallback' }, corsHeaders);
      }
    }
  } catch (_) {}

  // 4) Hard default
  return ok({ success: true, amount: DEFAULT_AMOUNT, currency: 'JPY', source: 'default' }, corsHeaders);
}
