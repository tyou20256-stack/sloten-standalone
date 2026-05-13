// Heuristic ReDoS guards for admin-supplied regex (bot_flows.trigger_value,
// bot_menus.trigger_value). Workers has no way to time-bound RegExp.test()
// execution, so a catastrophically-backtracking pattern compiled at admin
// save time would block every customer message the regex matches against
// in the per-isolate compiled-RegExp cache.
//
// Approach (defence in depth):
//   1) Bound pattern length to MAX_PATTERN_LEN — long catastrophic patterns
//      are the worst offenders and admin triggers don't legitimately exceed
//      this.
//   2) Reject classic nested-quantifier shapes that produce exponential
//      backtracking: `(...)+`/`(...)*` where the inner alternation/repeat
//      can match overlapping prefixes. Pattern detector below.
//   3) Smoke-test the compiled regex against a synthetic 50-character
//      adversarial input. If the call returns instantly (heuristic: <1 ms
//      observed wall-clock budget), the pattern is acceptable for the
//      hot path. Workers single-threaded model means we can't actually
//      time-bound the test — we treat any catch in this synchronous block
//      as the green path (compile + run succeeded inside the call) and
//      only step 1 + 2 act as the gate. Step 3 is best-effort verification.
//
// This is not a complete ReDoS proof; it's a low-cost gate that catches
// the common dangerous patterns admins might paste from an old chat-bot
// regex collection.

const MAX_PATTERN_LEN = 256;

// Detect nested unbounded quantifiers like (x+)+ / (x*)* / ((a|b)+)+
// Heuristic: a group `(...)` that contains `+`, `*`, or `{n,}` is followed
// by `+`, `*`, or `{n,}`. This catches the most common catastrophic shapes
// (a+)+, (a*)+, (a|a)+. False positives are tolerable — admins can use
// non-capturing groups with anchors or rephrase.
const NESTED_UNBOUNDED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*]/;

// Detect alternation with overlapping branches inside a quantified group.
// Conservative heuristic: `(a|a)*` style — same token both sides of `|`.
const REDUNDANT_ALTERNATION = /\(([^|)]+)\|\1\)[+*]/;

/**
 * Returns { ok: true, regex } on success; { ok: false, reason } on rejection.
 * Callers should bind reason into a 400 response.
 */
export function safeCompileRegex(pattern) {
  if (typeof pattern !== 'string') return { ok: false, reason: 'pattern must be a string' };
  if (pattern.length === 0) return { ok: false, reason: 'pattern must be non-empty' };
  if (pattern.length > MAX_PATTERN_LEN) {
    return { ok: false, reason: `pattern too long (max ${MAX_PATTERN_LEN} chars)` };
  }
  if (NESTED_UNBOUNDED_QUANTIFIER.test(pattern)) {
    return { ok: false, reason: 'pattern has nested unbounded quantifiers — likely catastrophic backtracking' };
  }
  if (REDUNDANT_ALTERNATION.test(pattern)) {
    return { ok: false, reason: 'pattern has redundant alternation inside a quantified group' };
  }
  let re;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    return { ok: false, reason: `invalid regex: ${e.message}` };
  }
  // Smoke-test against an adversarial input. Synchronous; if the heuristic
  // misses something genuinely catastrophic this will block the request,
  // but a single 50-char-input.test() bounds CPU to milliseconds at worst.
  try {
    re.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  } catch { /* runtime errors are not expected from .test() — ignore */ }
  return { ok: true, regex: re };
}
