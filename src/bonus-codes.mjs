// Bonus code matching. Ports the production Chatwoot bot's bonus code logic
// to standalone, backed by D1 (bonus_codes table) instead of KV. See
// migrations/014-bonus-codes.sql for the schema.
//
// Public API:
//   matchBonusCode(env, tenantId, text)  -> { matched, row?, code? }
//   recordSubmission(env, { tenantId, conversationId, contactId, match, code })
//   getBonusReply(row) -> { content, items: [{title, value}] | [] }

function removeSpaces(s) {
  return String(s || '').replace(/[\s\u3000]/g, '');
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

function matchOne(codes, normalizedInput, matchMode) {
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

// Returns { matched: true, row, code } where `row` is the bonus_codes row
// and `code` is the canonical code string that matched. When no code
// matches, returns { matched: false }.
export async function matchBonusCode(env, tenantId, text) {
  const normalized = removeSpaces(text);
  if (!normalized) return { matched: false };

  const { results } = await env.DB.prepare(
    `SELECT * FROM bonus_codes
        WHERE tenant_id = ? AND enabled = 1
        ORDER BY priority DESC, id ASC`,
  ).bind(tenantId || 'tenant_default').all();

  for (const row of results || []) {
    const codes = parseJson(row.codes, []);
    if (!Array.isArray(codes) || !codes.length) continue;
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
export async function forwardToGas(env, ctx, { submissionId, match, conversationId, contact }) {
  if (!match?.row?.gas_type) return;
  const { getEnvValue } = await import('./env-resolver.mjs');
  const url = await getEnvValue(env, 'BONUS_CODE_WEBHOOK_URL');
  if (!url) return;
  const payload = {
    event: 'bonus_code_submit',
    type: match.row.type_key,
    gas_type: match.row.gas_type,
    code: match.code,
    conversation_id: conversationId,
    contact: contact ? { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone } : null,
  };
  const task = async () => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
