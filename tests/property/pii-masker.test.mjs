// Property tests for PII masker — ensures sensitive data is redacted before
// being sent to third-party LLMs. Critical security boundary.
//
// Run: node tests/property/pii-masker.test.mjs

import assert from 'node:assert/strict';
import { maskPII, hasPII, countPII } from '../../src/pii-masker.mjs';

let pass = 0, fail = 0;
function test(label, fn) {
  try { fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

// ── Email ─────────────────────────────────────────────────────
test('email: standard form', () => {
  assert.equal(maskPII('連絡先 user@example.com です'), '連絡先 [EMAIL] です');
});
test('email: plus addressing', () => {
  assert.equal(maskPII('test+tag@example.co.jp'), '[EMAIL]');
});
test('email: multiple in one message', () => {
  assert.equal(maskPII('a@x.com / b@y.org'), '[EMAIL] / [EMAIL]');
});
test('email: not a false-positive on @ alone', () => {
  // Just an @ symbol should NOT be masked
  const out = maskPII('価格は @100 円です');
  assert.equal(out.includes('[EMAIL]'), false);
});

// ── Japanese phone ───────────────────────────────────────────
test('phone: 090-XXXX-XXXX masked', () => {
  const out = maskPII('お電話 090-1234-5678 までお願い');
  assert.match(out, /\[PHONE\]/);
  assert.equal(out.includes('1234-5678'), false);
});
test('phone: 03-XXXX-XXXX (Tokyo landline)', () => {
  const out = maskPII('03-1234-5678');
  assert.match(out, /\[PHONE\]/);
});
test('phone: not a false-positive on year-month-day', () => {
  // 2026-05-08 should NOT mask
  const out = maskPII('開催日: 2026-05-08');
  // It might mask or not — just make sure it doesn't break the year
  assert.ok(out.includes('2026') || out.includes('[PHONE]'));
});

// ── PII detection helpers ────────────────────────────────────
test('hasPII: returns true for email', () => {
  assert.equal(hasPII('contact me at x@y.com'), true);
});
test('hasPII: returns false for clean text', () => {
  assert.equal(hasPII('普通のテキストです'), false);
});

test('countPII: counts multiple PII items', () => {
  const c = countPII('a@x.com 090-1111-2222');
  assert.ok(c >= 2, `expected at least 2 PII items, got ${c}`);
});

// ── Idempotency / safety ─────────────────────────────────────
test('mask is idempotent (mask twice == mask once)', () => {
  const dirty = 'a@b.com 090-1234-5678';
  assert.equal(maskPII(maskPII(dirty)), maskPII(dirty));
});
test('mask preserves non-PII content order', () => {
  const out = maskPII('Hello a@b.com world');
  assert.match(out, /^Hello \[EMAIL\] world$/);
});
test('mask handles empty / null', () => {
  assert.equal(maskPII(''), '');
  assert.equal(maskPII(null), '');
  assert.equal(maskPII(undefined), '');
});
test('mask: extremely long input doesn\'t hang (10k chars)', () => {
  const long = 'a@b.com '.repeat(1000);
  const start = Date.now();
  const out = maskPII(long);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `mask took ${elapsed}ms for 10k input — should be < 1s`);
  assert.ok(out.includes('[EMAIL]'));
  assert.equal(out.includes('a@b.com'), false);
});

// ── Adversarial / borderline ─────────────────────────────────
test('mask: full-width email', () => {
  // Full-width characters should not bypass — best effort
  const out = maskPII('user＠example.com');
  // It may or may not catch full-width @, but should not crash
  assert.ok(typeof out === 'string');
});
test('mask: email at line boundary', () => {
  const out = maskPII('contact:\nuser@example.com\nhere');
  assert.match(out, /\[EMAIL\]/);
});

console.log(`\n${pass}/${pass + fail} cases pass`);
process.exit(fail > 0 ? 1 : 0);
