// Integration tests for /api/v1 alias + X-Sloten-Trace-Id header propagation.
//
//   - /api/v1/<path> must be treated as an alias for /api/<path>
//   - Every response must carry X-Sloten-Trace-Id (UUID v4 format) including
//     CORS preflight responses
//   - An untrusted caller cannot push a chosen trace id via the inbound header
//
// Run: BASE_URL=https://... node tests/integration/api-versioning-and-trace.test.mjs

import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';

let pass = 0, fail = 0;
async function step(label, fn) {
  try { await fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; throw e; }
}

const UUID_LIKE = /^[a-f0-9-]{16,40}$/i;

// ─── /api/v1 alias ──────────────────────────────────────────────
await step('/api/v1/public/jackpot returns same shape as /api/public/jackpot', async () => {
  const [a, b] = await Promise.all([
    fetch(`${BASE}/api/public/jackpot`),
    fetch(`${BASE}/api/v1/public/jackpot`),
  ]);
  assert.equal(a.status, b.status, `status mismatch: ${a.status} vs ${b.status}`);
  const [ja, jb] = await Promise.all([a.json(), b.json()]);
  // Don't compare timestamps; just verify the wrapper shape matches.
  assert.equal(ja.success, jb.success);
  assert.equal(typeof ja.amount, typeof jb.amount);
});

await step('/api/v1/widget/contacts (POST) creates a contact like /api/widget/contacts', async () => {
  const r = await fetch(`${BASE}/api/v1/widget/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.ok(body.contact?.id, 'contact id missing');
  assert.ok(body.contact_token, 'contact token missing');
});

await step('/api/v1 alias reaches ROUTES-table endpoints (not just inline ones)', async () => {
  // Regression guard for the 2026-05-14 bug where dispatchRoute re-derived
  // the path from request.url and bypassed the /api/v1 rewrite for every
  // table route. An unauthenticated call must hit the auth gate (401),
  // NOT fall through to 404 — 404 means the alias never routed into the
  // table at all.
  const r = await fetch(`${BASE}/api/v1/dashboard/stats`);
  assert.equal(r.status, 401, `expected 401 (auth gate reached), got ${r.status} — /api/v1 alias not routing into ROUTES table`);
});

// ─── Trace ID propagation ───────────────────────────────────────
await step('GET /health echoes X-Sloten-Trace-Id (generated UUID)', async () => {
  const r = await fetch(`${BASE}/health`);
  const trace = r.headers.get('X-Sloten-Trace-Id');
  assert.ok(trace, 'trace header missing');
  assert.match(trace, UUID_LIKE, `bad trace format: ${trace}`);
});

await step('GET /version returns trace id, different every call', async () => {
  const r1 = await fetch(`${BASE}/version`);
  const r2 = await fetch(`${BASE}/version`);
  const t1 = r1.headers.get('X-Sloten-Trace-Id');
  const t2 = r2.headers.get('X-Sloten-Trace-Id');
  assert.ok(t1 && t2);
  assert.notEqual(t1, t2, 'trace ids should be unique per request');
});

await step('OPTIONS preflight also carries X-Sloten-Trace-Id', async () => {
  const r = await fetch(`${BASE}/api/widget/contacts`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://sloten.io',
      'Access-Control-Request-Method': 'POST',
    },
  });
  // Preflight may be 204 or 403 depending on Origin allowlist; either way
  // it should carry the trace id.
  const trace = r.headers.get('X-Sloten-Trace-Id');
  assert.ok(trace, `preflight missing trace id (status=${r.status})`);
  assert.match(trace, UUID_LIKE);
});

await step('untrusted caller cannot inject custom trace id', async () => {
  // No bearer token → inbound trace id must be ignored, server generates fresh.
  const customTrace = 'attacker-supplied-id-aaaaa';
  const r = await fetch(`${BASE}/health`, {
    headers: { 'X-Sloten-Trace-Id': customTrace },
  });
  const trace = r.headers.get('X-Sloten-Trace-Id');
  assert.notEqual(trace, customTrace, 'attacker trace id was honoured!');
  assert.match(trace, UUID_LIKE);
});

console.log(`\n${pass}/${pass + fail} steps pass`);
process.exit(fail > 0 ? 1 : 0);
