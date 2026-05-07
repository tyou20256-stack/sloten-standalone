// Shared text classification helpers.
//
// These predicates are used by multiple call sites (bot-flows entry trigger,
// in-flow select-step fallback, ai-chat-adapter english short-circuit). Keeping
// them centralized prevents drift — earlier each site had its own slightly
// different regex range (e.g. [぀-ヿ㐀-鿿] vs [぀-ゟ゠-ヿ一-鿿]).

// Hiragana + Katakana + CJK Unified Ideographs (basic + ext-A subset).
// Includes Halfwidth Katakana via the ゠-ヿ block boundary check.
const JA_CHAR_RE = /[぀-ゟ゠-ヿ一-鿿]/;

// Latin / Hangul / Cyrillic — used for "non-Japanese language detection"
// short-circuit. Any of these *and* no JA char => treat as non-Japanese query.
const NON_JA_LETTER_RE = /[A-Za-z㄰-㆏가-힯Ѐ-ӿ]/;

/** Returns true if the string contains any Japanese character. */
export function hasJapanese(s) {
  return JA_CHAR_RE.test(String(s || ''));
}

/**
 * Returns true if the input looks like a real free-text question rather than
 * a button payload / single character / short ack. The caller decides what
 * to do with the signal (route to AI vs re-prompt menu).
 *
 *   true  for: "出金にどれくらい", "PayPay入金方法", "How do I deposit?"
 *   false for: "a", "?", "atm", "1"
 */
export function looksLikeFreeText(s) {
  const t = String(s || '').trim();
  return hasJapanese(t) || t.length >= 5;
}

/**
 * Returns true if the message is purely non-Japanese (English/Korean/Cyrillic)
 * and long enough to be a real query. Used by ai-chat-adapter to short-circuit
 * with the "Japanese-only support" canned response before calling the LLM.
 */
export function isNonJapaneseQuery(s) {
  const t = String(s || '').trim();
  if (t.length < 3) return false;
  if (hasJapanese(t)) return false;
  return NON_JA_LETTER_RE.test(t);
}
