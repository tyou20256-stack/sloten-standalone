// Bonus code matching. Ports the production Chatwoot bot's bonus code logic
// to standalone, backed by D1 (bonus_codes table) instead of KV. See
// migrations/014-bonus-codes.sql for the schema.
//
// Public API:
//   matchBonusCode(env, tenantId, text)  -> { matched, row?, code? }
//   recordSubmission(env, { tenantId, conversationId, contactId, match, code })
//   getBonusReply(row) -> { content, items: [{title, value}] | [] }

import { bestEffortSync } from './lib/best-effort.mjs';

// Internal helpers \u2014 exported for property tests to exercise the matcher
// without spinning up a fake D1.
export function removeSpaces(s) {
  return String(s || '').replace(/[\s\u3000]/g, '');
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s !== 'string') return s;
  const parsed = bestEffortSync('bonus-codes:parseJson', () => JSON.parse(s));
  return parsed === undefined ? fallback : parsed;
}

export function matchOne(codes, normalizedInput, matchMode) {
  if (matchMode === 'case_insensitive') {
    const lower = normalizedInput.toLowerCase();
    for (const c of codes) {
      if (removeSpaces(c).toLowerCase() === lower) return c;
    }
    return null;
  }
  for (const c of codes) {
    if (removeSpaces(c) === normalizedInput) return c;
  }
  return null;
}

// Per-isolate cache for the bonus_codes rowset. Every customer message used
// to hit this query even when the message had no chance of matching any code
// (Perf audit H3, 2026-05-13). Now we:
//   1. Short-circuit when the normalized input is too short or has no
//      alphanumeric character (codes always contain letters/digits).
//   2. Cache the parsed rowset per tenant for 60 s. Admin CRUD bumps
//      updated_at, so refreshing every minute keeps staleness bounded.
const BONUS_ROW_CACHE = new Map();
const BONUS_ROW_TTL_MS = 60_000;

async function getEnabledBonusRows(env, tenantId) {
  const key = tenantId || 'tenant_default';
  const entry = BONUS_ROW_CACHE.get(key);
  if (entry && entry.expires > Date.now()) return entry.rows;
  const { results } = await env.DB.prepare(
    `SELECT * FROM bonus_codes
        WHERE tenant_id = ? AND enabled = 1
        ORDER BY priority DESC, id ASC`,
  ).bind(key).all();
  // Pre-parse the JSON codes array once so per-message matching is allocation
  // free. matchOne expects a string array.
  // Object.freeze each row + the array (audit M4, 2026-05-13 second pass):
  // the cache is shared across requests in the isolate. A future caller that
  // mutates a row would silently corrupt every subsequent reply.
  const rows = Object.freeze((results || []).map((row) => Object.freeze({
    ...row,
    _parsedCodes: Object.freeze(parseJson(row.codes, []) || []),
  })));
  BONUS_ROW_CACHE.set(key, { rows, expires: Date.now() + BONUS_ROW_TTL_MS });
  return rows;
}

// Returns { matched: true, row, code } where `row` is the bonus_codes row
// and `code` is the canonical code string that matched. When no code
// matches, returns { matched: false }.
export async function matchBonusCode(env, tenantId, text) {
  const normalized = removeSpaces(text);
  if (!normalized) return { matched: false };
  // Bonus codes always include at least one alphanumeric character; bail out
  // early on pure punctuation/whitespace input to avoid the rowset fetch +
  // per-row linear scan on greetings / menu clicks.
  if (!/[\p{L}\p{N}]/u.test(normalized)) return { matched: false };

  const rows = await getEnabledBonusRows(env, tenantId);

  for (const row of rows) {
    const codes = row._parsedCodes;
    if (!codes.length) continue;
    const hit = matchOne(codes, normalized, row.match_mode);
    if (hit) return { matched: true, row, code: hit };
  }
  return { matched: false };
}

export function getBonusReply(row) {
  if (!row) return null;
  const items = parseJson(row.success_items, null);
  return {
    content: row.success_content || '',
    items: Array.isArray(items) ? items : [],
  };
}

export async function recordSubmission(env, { tenantId, conversationId, contactId, match, code }) {
  if (!match || !match.matched) return null;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO bonus_code_submissions (tenant_id, conversation_id, contact_id, bonus_code_id, type_key, code_submitted)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      tenantId || 'tenant_default',
      conversationId,
      contactId || null,
      match.row.id,
      match.row.type_key,
      code || '',
    ).run();
    return r.meta?.last_row_id || null;
  } catch (e) {
    console.warn('[bonus-codes] recordSubmission failed:', e.message);
    return null;
  }
}

// Forward the submission to GAS when the bonus_codes row has a gas_type set.
// Fire-and-forget via ctx.waitUntil. Adds `gas_response` to the submission
// row on completion (best-effort).
//
// Payload includes both the legacy keys (event/type/gas_type/code/contact)
// AND the chatwoot-final-working v10.0 GAS keys (userId/bonusCode/bonusType/
// sheetName) so the same GAS endpoint can dispatch via switch-case (built-in
// types) OR fall through to the dynamic recordToBonusSheet(sheetName, ...)
// branch for codes added through the admin UI.
export async function forwardToGas(env, ctx, { submissionId, match, conversationId, contact, traceId }) {
  if (!match?.row?.gas_type) return;
  const { getEnvValue } = await import('./env-resolver.mjs');
  const { signOutgoingWebhook } = await import('./lib/webhook-signature.mjs');
  const url = await getEnvValue(env, 'BONUS_CODE_WEBHOOK_URL');
  if (!url) return;
  const row = match.row;
  // Resolve sheetName: prefer explicit row.sheet_name, else fall back to the
  // production convention 'BC_' + display_name. Truncated to 100 chars to
  // match Google Sheets' tab-name limit.
  const resolvedSheetName = (row.sheet_name && String(row.sheet_name).trim())
    ? String(row.sheet_name).trim()
    : ('BC_' + (row.display_name || row.type_key)).slice(0, 100);
  const userId = contact?.name || contact?.email || (contact?.id ? `contact_${contact.id}` : 'unknown');
  const payload = {
    // Legacy / sloten-standalone format — preserved for back-compat
    event: 'bonus_code_submit',
    type: row.type_key,
    gas_type: row.gas_type,
    code: match.code,
    conversation_id: conversationId,
    contact: contact ? { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone } : null,
    // chatwoot-final-working GAS v10.0 format — for spreadsheet routing
    userId,
    conversationId,
    bonusCode: match.code,
    bonusType: row.gas_type,    // GAS switch-case key (BC_XXX)
    sheetName: resolvedSheetName,
  };
  const task = async () => {
    try {
      const bodyStr = JSON.stringify(payload);
      // HMAC-sign outbound so the receiving GAS endpoint can authenticate the
      // request (Security audit H-3, 2026-05-13). signOutgoingWebhook throws
      // in production when WEBHOOK_SIGNING_SECRET is missing — that's deliberate
      // (fail-closed), and matches the bot-flows.mjs webhook step.
      const sigHeaders = await signOutgoingWebhook(env.WEBHOOK_SIGNING_SECRET, bodyStr, env);
      // Trace correlation (audit C6, 2026-05-13): propagate the request's
      // trace id so the GAS receiver can correlate downstream actions.
      const traceHeaders = traceId ? { 'X-Sloten-Trace-Id': traceId } : {};
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sigHeaders, ...traceHeaders },
        body: bodyStr,
      });
      const text = await r.text().catch(() => '');
      if (submissionId) {
        await env.DB.prepare(
          `UPDATE bonus_code_submissions SET gas_forwarded = 1, gas_response = ? WHERE id = ?`,
        ).bind(text.slice(0, 2000), submissionId).run().catch(() => {});
      }
    } catch (e) {
      console.warn('[bonus-codes] GAS forward failed:', e.message);
    }
  };
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task());
  else task().catch(() => {});
}
