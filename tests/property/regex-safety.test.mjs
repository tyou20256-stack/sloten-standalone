// Property tests for the ReDoS-guarded regex compiler used by bot_flows
// and bot_menus admin save paths.
// Run: node tests/property/regex-safety.test.mjs

import assert from 'node:assert/strict';
import { safeCompileRegex } from '../../src/lib/regex-safety.mjs';

let pass = 0, fail = 0;
function test(label, fn) {
  try { fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; }
}

// --- Acceptance cases (these MUST compile) -------------------------
const ACCEPT = [
  '^paypay$',
  '入金|送金',
  '\\b(?:deposit|withdraw)\\b',
  '^[A-Z]{3}-[0-9]{4}$',
  '(?:ジャグラー|スロット)',          // alternation, no nesting
  '^(?:ABC|DEF|GHI)$',                  // bounded alternation
  '^.{1,200}$',                         // bounded quantifier
  'abc?def',                            // optional non-greedy
];
for (const p of ACCEPT) {
  test(`accept: ${p}`, () => {
    const r = safeCompileRegex(p);
    assert.equal(r.ok, true, `expected ok, got reason=${r.reason}`);
    assert.ok(r.regex instanceof RegExp);
  });
}

// --- Rejection cases (ReDoS patterns) -----------------------------
const REJECT_PATTERNS = [
  '(a+)+',                              // classic catastrophic
  '(a*)*',                              // unbounded star nested
  '(a*)+',
  '(a|a)*',                             // redundant alternation
  '(\\w|\\w)*',
  '(.+)+$',
  '(ab|ab)+',
];
for (const p of REJECT_PATTERNS) {
  test(`reject ReDoS pattern: ${p}`, () => {
    const r = safeCompileRegex(p);
    assert.equal(r.ok, false, `expected rejection, but compiled`);
    assert.ok(r.reason, 'reason must be set when ok=false');
  });
}

// --- Format / validity rejections ---------------------------------
test('reject non-string', () => {
  assert.equal(safeCompileRegex(123).ok, false);
  assert.equal(safeCompileRegex(null).ok, false);
  assert.equal(safeCompileRegex(undefined).ok, false);
});

test('reject empty pattern', () => {
  assert.equal(safeCompileRegex('').ok, false);
});

test('reject overlong pattern (>256 chars)', () => {
  const longPattern = 'a'.repeat(300);
  const r = safeCompileRegex(longPattern);
  assert.equal(r.ok, false);
  assert.match(r.reason, /too long/);
});

test('reject malformed regex', () => {
  const r = safeCompileRegex('[unclosed');
  assert.equal(r.ok, false);
  assert.match(r.reason, /invalid regex/);
});

// --- Returned RegExp is functional --------------------------------
test('accepted pattern returns working RegExp', () => {
  const r = safeCompileRegex('^hello$');
  assert.equal(r.ok, true);
  assert.equal(r.regex.test('hello'), true);
  assert.equal(r.regex.test('hello world'), false);
});

console.log(`\n${pass}/${pass + fail} cases pass`);
if (fail > 0) process.exit(1);
