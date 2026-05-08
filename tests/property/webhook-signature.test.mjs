// Property tests for webhook signature signing & verification.
// Run: node tests/property/webhook-signature.test.mjs

import assert from 'node:assert/strict';
import { signOutgoingWebhook, verifyIncomingWebhook } from '../../src/lib/webhook-signature.mjs';

let pass = 0, fail = 0;
async function test(label, fn) {
  try { await fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

const SECRET = 'test-secret-32bytes-here-for-hmac-test-aaa';

// Build a Headers shim
function makeHeaders(obj) { return new Headers(obj); }

await test('sign returns sig + timestamp headers', async () => {
  const h = await signOutgoingWebhook(SECRET, '{"hello":"world"}');
  assert.ok(h['X-Sloten-Signature'], 'missing signature');
  assert.ok(h['X-Sloten-Timestamp'], 'missing timestamp');
  assert.match(h['X-Sloten-Signature'], /^[0-9a-f]{64}$/);
});

await test('verify accepts a freshly signed request', async () => {
  const body = '{"deposit":1000}';
  const h = await signOutgoingWebhook(SECRET, body);
  const headers = makeHeaders(h);
  const ok = await verifyIncomingWebhook(SECRET, headers, body);
  assert.equal(ok, true);
});

await test('verify rejects tampered body', async () => {
  const h = await signOutgoingWebhook(SECRET, '{"deposit":1000}');
  const ok = await verifyIncomingWebhook(SECRET, makeHeaders(h), '{"deposit":9999}');
  assert.equal(ok, false);
});

await test('verify rejects wrong secret', async () => {
  const body = '{"x":1}';
  const h = await signOutgoingWebhook(SECRET, body);
  const ok = await verifyIncomingWebhook('different-secret', makeHeaders(h), body);
  assert.equal(ok, false);
});

await test('verify rejects missing signature header', async () => {
  const ok = await verifyIncomingWebhook(SECRET, makeHeaders({ 'X-Sloten-Timestamp': '0' }), 'b');
  assert.equal(ok, false);
});

await test('verify rejects timestamp > 5 minutes old (replay defense)', async () => {
  const body = '{"x":1}';
  const oldTs = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 min ago
  // Build a signature that would have been valid 10 min ago
  const { hmacSignHex } = await import('../../src/lib/crypto.mjs');
  const sig = await hmacSignHex(SECRET, `webhook:v1|${oldTs}|${body}`);
  const headers = makeHeaders({ 'X-Sloten-Signature': sig, 'X-Sloten-Timestamp': oldTs });
  const ok = await verifyIncomingWebhook(SECRET, headers, body);
  assert.equal(ok, false);
});

await test('verify rejects future timestamp (clock skew bound)', async () => {
  const body = '{"x":1}';
  const futureTs = (Math.floor(Date.now() / 1000) + 600).toString();
  const { hmacSignHex } = await import('../../src/lib/crypto.mjs');
  const sig = await hmacSignHex(SECRET, `webhook:v1|${futureTs}|${body}`);
  const headers = makeHeaders({ 'X-Sloten-Signature': sig, 'X-Sloten-Timestamp': futureTs });
  const ok = await verifyIncomingWebhook(SECRET, headers, body);
  assert.equal(ok, false);
});

await test('verify rejects malformed timestamp', async () => {
  const headers = makeHeaders({ 'X-Sloten-Signature': 'a'.repeat(64), 'X-Sloten-Timestamp': 'not-a-number' });
  const ok = await verifyIncomingWebhook(SECRET, headers, 'b');
  assert.equal(ok, false);
});

await test('sign without secret returns empty headers (graceful)', async () => {
  const h = await signOutgoingWebhook(null, 'body');
  assert.deepEqual(h, {});
});

console.log(`\n${pass}/${pass + fail} cases pass`);
process.exit(fail > 0 ? 1 : 0);
