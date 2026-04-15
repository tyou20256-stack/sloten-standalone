/**
 * src/rate-limiter.mjs — Sloten AI Gateway rate limiting via Cloudflare KV
 *
 * Simple sliding window counter. Not a hard guarantee due to KV eventual
 * consistency, but adequate for soft abuse prevention at the edge.
 *
 * Usage:
 *   const check = await checkRateLimit(env, `ip:${ip}`, 60, 60);
 *   if (!check.allowed) return rateLimitResponse(check, corsHeaders);
 *
 * If env.RATE_LIMITER KV binding is missing, degrades open (allows all).
 */

// Module-level counter for alert dedup (per-isolate is fine).
let kvFailureCount = 0;
let lastAlertAt = 0;

async function alertKvFailure(env, error) {
  kvFailureCount++;
  const now = Date.now();
  // Throttle alerts: at most one per 5 minutes
  if (now - lastAlertAt < 5 * 60 * 1000) return;
  lastAlertAt = now;

  const telegramToken = env && env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = env && env.TELEGRAM_ALERT_CHAT_ID;
  if (!telegramToken || !telegramChatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: `⚠️ Sloten AI Gateway: rate limiter KV failure (count=${kvFailureCount})\nError: ${error?.message || error}\nRate limiting is now FAIL-OPEN — monitor closely.`,
      }),
    });
  } catch (e) {
    console.error('[rate-limiter] Telegram alert failed:', e.message);
  }
}

/**
 * Check and increment the rate-limit counter for a given key.
 * @param {object} env - Worker env with optional RATE_LIMITER KV binding
 * @param {string} key - Arbitrary key (e.g. `ip:1.2.3.4` or `aichat:1.2.3.4`)
 * @param {number} limit - Max requests allowed per window
 * @param {number} windowSeconds - Window size in seconds
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number, limit: number}>}
 */
export async function checkRateLimit(env, key, limit, windowSeconds, ctx) {
  if (!env || !env.RATE_LIMITER) {
    console.warn('[rate-limit] KV binding RATE_LIMITER not configured, allowing');
    return {
      allowed: true,
      remaining: limit,
      resetAt: Date.now() + windowSeconds * 1000,
      limit,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const kvKey = `rl:${key}:${windowStart}`;

  let current = 0;
  try {
    const raw = await env.RATE_LIMITER.get(kvKey);
    current = parseInt(raw || '0', 10);
    if (!Number.isFinite(current) || current < 0) current = 0;
  } catch (e) {
    console.error('[rate-limit] KV read failed:', e.message);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(alertKvFailure(env, e));
    } else {
      alertKvFailure(env, e).catch(() => {});
    }
    // ρ-Hπ4: fail closed for sensitive endpoints (auth/login). Caller can opt out
    // by setting env.RATE_LIMIT_FAIL_OPEN='true' (not recommended for prod).
    const failOpen = env?.RATE_LIMIT_FAIL_OPEN === 'true';
    return {
      allowed: failOpen,
      remaining: failOpen ? limit : 0,
      resetAt: (windowStart + windowSeconds) * 1000,
      limit,
      degraded: true,
    };
  }

  if (current >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: (windowStart + windowSeconds) * 1000,
      limit,
    };
  }

  // Eventual-consistency increment. Fine for soft rate limiting.
  // When ctx is provided, offload the KV put so it doesn't block the request.
  const putPromise = env.RATE_LIMITER.put(kvKey, String(current + 1), {
    expirationTtl: windowSeconds * 2,
  }).catch((e) => {
    console.error('[rate-limit] KV write failed, degrading open:', e.message);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(alertKvFailure(env, e));
    } else {
      alertKvFailure(env, e).catch(() => {});
    }
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(putPromise);
  } else {
    await putPromise;
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - current - 1),
    resetAt: (windowStart + windowSeconds) * 1000,
    limit,
  };
}

/**
 * Build a 429 Response for a failed rate-limit check.
 * @param {{allowed: boolean, remaining: number, resetAt: number, limit?: number}} check
 * @param {object} corsHeaders
 * @returns {Response}
 */
export function rateLimitResponse(check, corsHeaders) {
  const retryAfter = Math.max(1, Math.ceil((check.resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded', retry_after: retryAfter }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(check.limit || ''),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(check.resetAt / 1000)),
      },
    }
  );
}

/**
 * Derive a rate-limit key from the incoming request.
 * Body-based user extraction is intentionally NOT done here to avoid
 * double-parsing the request body in the router. Handler-level limiting
 * can refine per-user after the body is read.
 *
 * @param {Request} request
 * @param {'ip'|'user'|'ai'} type
 * @returns {string}
 */
export function getRateLimitKey(request, type) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  switch (type) {
    case 'ai':
      return `ai:${ip}`;
    case 'user':
      // Body parsing not done at router level; fall back to IP.
      return `ip:${ip}`;
    case 'ip':
    default:
      return `ip:${ip}`;
  }
}
