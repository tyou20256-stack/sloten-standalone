// PII masker — applied to user messages before sending to external LLMs
// ============================================
// Sloten AI Gateway — PII Masking Module
// pii-masker.mjs
// ============================================
//
// Masks personally identifiable information (email, phone, credit card,
// bank account, My Number, IP address) in user text before it is sent
// to any external LLM (e.g., Gemini). Only INPUT is masked — outgoing
// LLM responses are handled by filterResponse/filterOutput and should
// NOT be run through maskPII.
// ============================================

// ============================================
// 1. Patterns
// ============================================

const EMAIL_RE = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// International phone (E.164-ish): +CC followed by groups
const PHONE_INTL_RE = /\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/g;
const PHONE_MOBILE_JP_RE = /\b0[789]0[-\s]?\d{4}[-\s]?\d{4}\b/g;
const PHONE_LANDLINE_JP_RE = /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/g;
// Korean mobile: standard "010-1234-5678" (with leading 0) or "+82" prefix.
// τ-M: tightened — bare "10-1234-5678" (no leading 0, no +82) is too ambiguous
// (matches order numbers / dates), so we require explicit Korean indicator.
const PHONE_KR_MOBILE_RE = /(?:\+82[-\s]?|\b)0?1[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g;
// Chinese mobile: 11 digits starting with 1[3-9].
// τ-M: keep contiguous-only OR explicit +86 prefix. Bare spaced "1XX XXXX XXXX"
// over-matches Japanese phone book strings; require boundary or country code.
const PHONE_CN_MOBILE_RE = /(?:\+86[-\s]?|\b)1[3-9]\d(?:\d{8}|[-\s]\d{4}[-\s]\d{4})\b/g;
// Candidate card numbers: 13–19 digits with optional spaces/hyphens (multi-space tolerant)
const CARD_CANDIDATE_RE = /(?:\d[\s-]*){13,19}/g;
// Bank account with Japanese context label
const BANK_ACCOUNT_RE = /(口座|アカウント|振込|振り込み)([番号]*)([\s:：]*)(\d{7,8})/g;
// My Number (12 digits, optional separators)
const MYNUMBER_RE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// ============================================
// 2. Luhn validation (cards only)
// ============================================

function luhnValid(num) {
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// ============================================
// 3. maskPII
// ============================================

/**
 * Mask PII in text before sending to external LLMs.
 * @param {string} text
 * @returns {string}
 */
export function maskPII(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') return text;

  let out = text;

  // Email
  out = out.replace(EMAIL_RE, '[EMAIL]');

  // My Number (12 digits) — run BEFORE card so 12-digit sequences aren't
  // consumed by card regex. My Number is always exactly 12 digits.
  out = out.replace(MYNUMBER_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length === 12 ? '[MYNUMBER]' : m;
  });

  // Credit card — Luhn-validate, preserve last 4
  out = out.replace(CARD_CANDIDATE_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (!luhnValid(digits)) return m;
    return `[CARD:****${digits.slice(-4)}]`;
  });

  // Bank account (Japanese context)
  out = out.replace(BANK_ACCOUNT_RE, (_m, label, suffix, sep) => {
    return `${label}${suffix}${sep}[ACCOUNT]`;
  });

  // Phone — international first (before JP so +81... doesn't partially match JP)
  out = out.replace(PHONE_INTL_RE, '[PHONE]');
  // Phone (JP mobile then landline)
  out = out.replace(PHONE_MOBILE_JP_RE, '[PHONE]');
  out = out.replace(PHONE_LANDLINE_JP_RE, '[PHONE]');
  // Phone — Korean mobile + Chinese mobile
  out = out.replace(PHONE_KR_MOBILE_RE, '[PHONE]');
  out = out.replace(PHONE_CN_MOBILE_RE, '[PHONE]');

  // IP address
  out = out.replace(IP_RE, '[IP]');

  return out;
}

// ============================================
// 4. hasPII — fast heuristic (no Luhn)
// ============================================

/**
 * Quick boolean check for presence of any PII-shaped pattern.
 * No Luhn validation — used for logging/observability only.
 * @param {string} text
 * @returns {boolean}
 */
export function hasPII(text) {
  if (!text || typeof text !== 'string') return false;
  // New RegExp instances to avoid lastIndex state on /g regexes
  const patterns = [
    /[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    /\b0[789]0[-\s]?\d{4}[-\s]?\d{4}\b/,
    /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/,
    /\b(?:\d[ -]*?){13,19}\b/,
    /(?:口座|アカウント|振込|振り込み)[番号]*[\s:：]*\d{7,8}/,
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * Count how many distinct PII matches appear in text (used for logging).
 * @param {string} text
 * @returns {number}
 */
export function countPII(text) {
  if (!text || typeof text !== 'string') return 0;
  let count = 0;
  const add = (re) => {
    const m = text.match(re);
    if (m) count += m.length;
  };
  add(new RegExp(EMAIL_RE.source, 'g'));
  add(new RegExp(PHONE_MOBILE_JP_RE.source, 'g'));
  add(new RegExp(PHONE_LANDLINE_JP_RE.source, 'g'));
  add(new RegExp(CARD_CANDIDATE_RE.source, 'g'));
  add(new RegExp(BANK_ACCOUNT_RE.source, 'g'));
  add(new RegExp(MYNUMBER_RE.source, 'g'));
  add(new RegExp(IP_RE.source, 'g'));
  return count;
}
