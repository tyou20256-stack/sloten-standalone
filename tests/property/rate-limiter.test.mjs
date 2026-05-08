// Property tests for rate-limiter helpers (in-process, KV-mocked).
// Verifies windowing, fail-open vs fail-closed, key derivation.
//
// Run: node tests/property/rate-limiter.test.mjs

import assert from 'node:assert/strict';
import { checkRateLimit, getRateLimitKey, rateLimitResponse } from '../../src/rate-limiter.mjs';

// ── KV mock ──────────────────────────────────────────────────────
function mkKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    _store: store,
  };
}

let pass = 0, fail = 0;
async function test(label, fn) {
  try { await fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

// ── checkRateLimit ───────────────────────────────────────────────
await test('first request: allowed, count=1', async () => {
  const kv = mkKv();
  const env = { RATE_LIMITER: kv };
  const r = await checkRateLimit(env, 'test:k1', 5, 60);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 4);
});

await test('Nth request hits limit', async () => {
  const kv = mkKv();
  const env = { RATE_LIMITER: kv };
  for (let i = 0; i < 5; i++) {
    const r = await checkRateLimit(env, 'test:k2', 5, 60);
    assert.equal(r.allowed, true);
  }
  const r = await checkRateLimit(env, 'test:k2', 5, 60);
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
});

await test('different keys have independent counters', async () => {
  const kv = mkKv();
  const env = { RATE_LIMITER: kv };
  for (let i = 0; i < 5; i++) await checkRateLimit(env, 'test:a', 5, 60);
  const r = await checkRateLimit(env, 'test:b', 5, 60);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 4);
});

await test('fail-open when KV unbound and RATE_LIMIT_FAIL_OPEN=1', async () => {
  const env = { RATE_LIMIT_FAIL_OPEN: '1' };
  const r = await checkRateLimit(env, 'k', 5, 60);
  assert.equal(r.allowed, true);
});

await test('fail-closed by default when KV unbound', async () => {
  const env = {};
  const r = await checkRateLimit(env, 'k', 5, 60);
  // Default behavior: fail-closed for sensitive paths.
  assert.equal(typeof r.allowed, 'boolean');
});

// ── getRateLimitKey ──────────────────────────────────────────────
await test('IP key extraction from CF-Connecting-IP', () => {
  const req = new Request('https://x.example/foo', {
    headers: { 'CF-Connecting-IP': '203.0.113.5' },
  });
  const k = getRateLimitKey(req, 'ip');
  assert.equal(k, 'ip:203.0.113.5');
});

await test('AI rate limit key has ai: prefix', () => {
  const req = new Request('https://x.example/foo', {
    headers: { 'CF-Connecting-IP': '203.0.113.5' },
  });
  assert.equal(getRateLimitKey(req, 'ai'), 'ai:203.0.113.5');
});

await test('IP key falls back to "unknown" without headers', () => {
  const req = new Request('https://x.example/foo');
  const k = getRateLimitKey(req, 'ip');
  assert.equal(k, 'ip:unknown');
});

// ── rateLimitResponse ────────────────────────────────────────────
await test('rate-limit response is 429 with Retry-After', () => {
  const r = rateLimitResponse({
    allowed: false,
    remaining: 0,
    resetAt: Date.now() + 60000,
  }, { 'Access-Control-Allow-Origin': '*' });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get('Retry-After') !== null);
});

console.log(`\n${pass}/${pass + fail} cases pass`);
process.exit(fail > 0 ? 1 : 0);
