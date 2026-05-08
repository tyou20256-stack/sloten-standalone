// Unit test for soak.js bot_replied detection logic.
//
// The substring fallback used when JSON.parse fails must:
//   1. Match populated bot_replies arrays
//   2. Match singular bot_reply objects
//   3. NOT match empty arrays (`bot_replies: []`)
//   4. NOT match empty/null values
//
// Run: node tests/load/fallback.test.mjs

import assert from 'node:assert/strict';

// Reproduce the fallback predicate from tests/load/soak.js (must stay in sync)
function detectBotReply(body) {
  body = body || '';
  return body.includes('"bot_replies":[{') || body.includes('"bot_reply":{"');
}

const cases = [
  // [body, expected, label]
  ['{"bot_replies":[{"id":"a","content":"hi"}]}', true, 'populated bot_replies array'],
  ['{"bot_reply":{"id":"x","content":"y"}}', true, 'singular bot_reply object'],
  ['{"bot_replies":[]}', false, 'empty bot_replies array'],
  ['{"bot_replies":[],"meta":{}}', false, 'empty bot_replies with extras'],
  ['{"bot_reply":null}', false, 'null bot_reply'],
  ['', false, 'empty body'],
  [null, false, 'null body'],
  ['{"some_other":"thing"}', false, 'unrelated body'],
  // Truncation cases — substring fallback should still detect populated structure
  ['{"bot_replies":[{"id":"a","content":"truncat', true, 'truncated populated array'],
  ['{"bot_reply":{"id":"x","conten', true, 'truncated singular object'],
  // Adversarial: a field literally named "bot_repl_xyz" should NOT trip a loose match
  ['{"bot_replies_alt":[{"id":"x"}]}', false, 'adjacent field name does not match'],
];

let passed = 0;
let failed = 0;
for (const [body, expected, label] of cases) {
  try {
    const actual = detectBotReply(body);
    assert.equal(actual, expected, label);
    console.log(`✓ ${label}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${label}: expected=${expected} actual=${detectBotReply(body)}`);
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} cases pass`);
if (failed > 0) {
  console.error('FAIL — soak.js fallback logic regression detected');
  process.exit(1);
}
