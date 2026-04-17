// Env resolver: lets admins override secrets at runtime via the
// `env_overrides` D1 table without redeploying. The override is checked
// first; if absent, falls back to the static env binding.
//
// Cached in-process for 30s to avoid hammering D1 on every fetch.

const CACHE_TTL_MS = 30_000;
let cache = new Map();   // key -> { value, expiresAt }

export async function getEnvValue(env, key) {
  if (!env || !key) return '';
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  let value = '';
  try {
    if (env.DB) {
      const row = await env.DB.prepare(
        'SELECT value FROM env_overrides WHERE key = ?',
      ).bind(key).first();
      if (row && typeof row.value === 'string' && row.value) {
        value = row.value;
      }
    }
  } catch (_) { /* fall through to static env */ }

  if (!value) {
    const v = env[key];
    if (typeof v === 'string') value = v;
  }

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// Bust the cache after an admin write so the next read picks up the change
// immediately (rather than waiting up to 30 s).
export function clearEnvCache(key) {
  if (key) cache.delete(key);
  else cache = new Map();
}

// Keys whose values may be overridden via env_overrides. Used to build a
// resolved env snapshot for template rendering ({{env.GAS_BOT_WEBHOOK_URL}}
// inside bot flow webhook steps).
export const OVERRIDABLE_KEYS = [
  'GAS_BOT_WEBHOOK_URL',
  'BANK_TRANSFER_BOT_WEBHOOK_URL',
  'EC_DEPOSIT_BOT_WEBHOOK_URL',
  'BONUS_CODE_WEBHOOK_URL',
  'OPERATOR_ATTACHMENT_WEBHOOK_URL',
];

// Builds a {KEY: resolved_value} map for the overridable secrets. Returns a
// Proxy that delegates to the underlying env binding for any other key, so
// template placeholders like {{env.PUBLIC_WORKER_URL}} still work.
export async function resolveEnvForTemplate(env) {
  const map = {};
  for (const k of OVERRIDABLE_KEYS) map[k] = await getEnvValue(env, k);
  return new Proxy(map, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      return env[prop];
    },
  });
}
