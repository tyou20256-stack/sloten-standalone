// Live announcements RAG — fetches official notifications from sloten.io and
// injects them into the AI system prompt when the user's query suggests they
// want maintenance / campaign / period-specific information.
//
// Source: https://sloten.io/api/public/announcements
//   → [{id, title, content (HTML), createAt}, ...]
//
// Cache: KV (RATE_LIMITER namespace, key 'announcements:v1', 10-min TTL).
// HTML stripped to plain text before injection.

const ANNOUNCEMENTS_URL = 'https://sloten.io/api/public/announcements';
const CACHE_KEY = 'announcements:v1';
const CACHE_TTL_SECONDS = 600; // 10 min — sloten.io traffic guard

// Keyword patterns that signal "the user is asking about announcements".
// Combined with `length >= 3` so casual single-char particles don't match.
const ANNOUNCEMENT_QUERY_PATTERNS = [
  /お知らせ/,
  /通知|アナウンス|告知|お報せ/,
  /メンテナンス|定期点検|システム更新/,
  /(?:期間中|連休中|営業時間|営業日|休業)/,
  /GW|ゴールデンウィーク|お盆|年末年始|シルバーウィーク/,
  /(?:最新|直近|今日|本日|昨日|今週).*(?:案内|情報|お知らせ|通知)/,
  /(?:案内|ご案内|注意事項|重要)/,
  /キャンペーン.*(?:期間|終了|開催|いつまで)/,
];

/**
 * Returns true when the message looks like an announcements / maintenance /
 * period-specific question.
 */
export function detectAnnouncementQuery(message) {
  if (!message || typeof message !== 'string') return false;
  for (const re of ANNOUNCEMENT_QUERY_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

/**
 * Sanitize untrusted retrieved content before LLM injection. Removes:
 * - Control chars (incl. CR/LF outside paragraph boundaries) — header injection
 * - Markdown heading prefixes (## / ### at start of line) — prompt structure spoof
 * - Unicode tag chars E0000-E007F — ASCII smuggling
 * - Zero-width chars — invisible payloads
 * Length-caps each entry to MAX_CHARS.
 */
function sanitizeUntrusted(s, maxChars = 500) {
  if (!s) return '';
  let out = String(s);
  // Strip control chars except space and the existing paragraph newlines we use
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Strip Unicode tag block (smuggling)
  out = out.replace(/[\u{E0000}-\u{E007F}]/gu, '');
  // Strip zero-width
  out = out.replace(/[​-‏﻿]/g, '');
  // Neutralize markdown headers at line start so attacker can't inject "## 新ルール"
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  // Hard cap
  if (out.length > maxChars) out = out.slice(0, maxChars) + '…（以下省略）';
  return out;
}

/**
 * Strip HTML tags + decode common entities. Keeps plain text suitable for
 * LLM context. Preserves URLs from <a href="..."> by inlining them as
 * "(URL: https://...)" so the AI can quote / show clickable links.
 */
function stripHtml(html) {
  if (!html) return '';
  let s = String(html);
  // Inline <a href="..."> URLs into the text so links survive the strip
  s = s.replace(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, text) => {
    const t = text.replace(/<[^>]+>/g, '').trim();
    return t ? `${t} (${url})` : url;
  });
  // <br> and block-level closing tags → newline so paragraphs survive
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|article|section)\s*>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '・');
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'");
  // Collapse whitespace
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/**
 * Format date to human-readable Japanese (YYYY/MM/DD).
 * Accepts: ISO 8601 ("2026-04-29T...") or Unix timestamp (seconds or millis).
 */
function formatDate(s) {
  if (!s) return '';
  const str = String(s);
  // ISO date: "2026-04-29T..." or "2026-04-29 ..."
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}/${isoMatch[2]}/${isoMatch[3]}`;
  // Unix timestamp: 10 digits = seconds, 13 digits = millis
  if (/^\d{10}$/.test(str)) {
    const d = new Date(Number(str) * 1000);
    if (!Number.isNaN(d.getTime())) return `${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  if (/^\d{13}$/.test(str)) {
    const d = new Date(Number(str));
    if (!Number.isNaN(d.getTime())) return `${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  return str;
}

// HMAC sign cached payload so an attacker who acquires KV write access on the
// shared RATE_LIMITER namespace cannot poison this cache to inject arbitrary
// content into the system prompt. Uses SESSION_SIGNING_KEY (already provisioned)
// with a dedicated context string so it can't be confused with session tokens.
async function hmacSign(key, message) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacVerify(key, message, expectedHex) {
  if (!expectedHex || typeof expectedHex !== 'string') return false;
  const got = await hmacSign(key, message);
  if (got.length !== expectedHex.length) return false;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}
const HMAC_CONTEXT = 'announcements:v1:hmac';

/**
 * Internal: fetch raw announcements (with KV cache).
 * Returns: { entries: [{id, title, content, createAt}], cached: bool, error?: string }
 */
async function fetchAnnouncementsRaw(env) {
  const kv = env.RATE_LIMITER || env.STATE_KV;
  const newKey = env.RAG_CACHE_SIGNING_KEY;
  const oldKey = env.SESSION_SIGNING_KEY;
  const signingKey = newKey || oldKey;
  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY, 'json');
      if (cached && Array.isArray(cached.entries) && cached.sig && signingKey) {
        const payload = HMAC_CONTEXT + '|' + JSON.stringify(cached.entries);
        // Try dedicated key first
        if (newKey && await hmacVerify(newKey, payload, cached.sig)) {
          return { entries: cached.entries, cached: true };
        }
        // Dual-verify: fallback to legacy shared key
        if (oldKey && oldKey !== newKey && await hmacVerify(oldKey, payload, cached.sig)) {
          console.log('[announcements] cache verified with legacy SESSION_SIGNING_KEY — rotate pending');
          return { entries: cached.entries, cached: true };
        }
        console.log('[announcements] cache HMAC mismatch — refetching');
      }
    } catch (_) { /* ignore KV read errors */ }
  }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(ANNOUNCEMENTS_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'sloten-standalone/1.0' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return { entries: [], cached: false, error: `HTTP ${r.status}` };
    const data = await r.json();
    if (!Array.isArray(data)) return { entries: [], cached: false, error: 'unexpected_shape' };
    const entries = data.map((e) => ({
      id: String(e.id || ''),
      title: String(e.title || ''),
      content: String(e.content || ''),
      createAt: String(e.createAt || ''),
    }));
    if (kv && signingKey) {
      try {
        const payload = HMAC_CONTEXT + '|' + JSON.stringify(entries);
        const sig = await hmacSign(signingKey, payload);
        await kv.put(CACHE_KEY, JSON.stringify({ entries, sig }), { expirationTtl: CACHE_TTL_SECONDS });
      } catch (_) { /* ignore KV write errors */ }
    }
    return { entries, cached: false };
  } catch (e) {
    return { entries: [], cached: false, error: e.message };
  }
}

// Period keywords that the user query might contain. When matched, we boost
// announcements whose title/content mentions the same period — so a "GW"
// question gets GW-specific announcements at the top, not just chronological.
const PERIOD_KEYWORDS = [
  { rx: /GW|ゴールデンウィーク/i, hint: ['GW', 'ゴールデンウィーク', '5月', '4月'] },
  { rx: /お盆/, hint: ['お盆', '盆休み', '8月'] },
  { rx: /年末年始|お正月|新年/, hint: ['年末年始', '正月', '12月', '1月'] },
  { rx: /シルバーウィーク/, hint: ['シルバーウィーク', '9月'] },
  { rx: /メンテナンス|定期点検/, hint: ['メンテナンス', '点検', '停止'] },
];

function periodScore(query, entryText) {
  const q = String(query || '');
  const t = String(entryText || '');
  for (const { rx, hint } of PERIOD_KEYWORDS) {
    if (rx.test(q)) {
      let s = 0;
      for (const h of hint) if (t.includes(h)) s += 1;
      return s;
    }
  }
  return 0;
}

/**
 * Build LLM context text from current announcements. Used by ai-chat-adapter
 * when detectAnnouncementQuery() fires.
 *
 * @param {object} env
 * @param {string} [userQuery] — user's raw message, used to bias entry selection
 * @returns {Promise<{context: string, entries_count: number, error?: string}>}
 */
export async function fetchAnnouncementsContext(env, userQuery) {
  const { entries, cached, error } = await fetchAnnouncementsRaw(env);
  if (error) return { context: '', entries_count: 0, error };
  if (!entries.length) {
    return { context: '【お知らせ】現在公開されているお知らせはありません。', entries_count: 0 };
  }
  // Limit to 5 most recent entries (sorted by id desc) and truncate each to
  // ~500 chars to keep the system prompt within Gemini's sweet spot.
  // When the user query has a period keyword (GW, お盆 etc.), boost matching
  // entries to the top so they are not crowded out by unrelated newer items.
  const MAX_ENTRIES = 5;
  const MAX_CONTENT_CHARS = 500;
  const ranked = entries.map((e) => ({
    e,
    score: periodScore(userQuery, (e.title || '') + ' ' + (e.content || '')),
    id: Number(e.id) || 0,
  })).sort((a, b) => (b.score - a.score) || (b.id - a.id));
  const sorted = ranked.slice(0, MAX_ENTRIES).map((x) => x.e);
  const lines = [
    `【sloten.io 公式お知らせ】(最新${sorted.length}件/${entries.length}件中、出典: https://sloten.io/notification${cached ? ' / キャッシュ' : ''})`,
    '',
  ];
  for (const e of sorted) {
    // Untrusted content from external API — sanitize before LLM injection.
    const safeTitle = sanitizeUntrusted(stripHtml(e.title || ''), 200);
    const text = sanitizeUntrusted(stripHtml(e.content || ''), MAX_CONTENT_CHARS);
    const date = formatDate(e.createAt);
    lines.push(`■ ${safeTitle}` + (date ? ` (${date}発信)` : ''));
    if (text) lines.push(text);
    lines.push('');
  }
  return {
    context: lines.join('\n').trim(),
    entries_count: entries.length,
    cached,
  };
}
