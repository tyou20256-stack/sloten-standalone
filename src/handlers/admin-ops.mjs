// Admin operations: webhook test, GAS URL editor, GAS ping, audit/error
// log readers, backup/restore. Mirrors the production chatwoot-bot admin
// admin-preview.html "運用・監視" tab.

import { ok, created, err, parseJson } from '../json.mjs';
import { getEnvValue, clearEnvCache, OVERRIDABLE_KEYS } from '../env-resolver.mjs';
import { audit, logError } from '../audit.mjs';
import { sendMessage } from './messages-native.mjs';
import { uuid } from '../id.mjs';
import { bestEffortSync } from '../lib/best-effort.mjs';

// --- Webhook test: sends a synthetic customer message and returns the bot
//     replies (does NOT broadcast / persist a real conversation).
//     Body: { message: '...', conversation_id?: '...' }
// Approach: create a throwaway conversation + contact, post the message
// through the same path the widget uses, return bot_replies, then clean up.
export async function adminTestBot(request, env, corsHeaders, ctx) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const text = String(body?.message || '').trim();
  if (!text) return err('message required', 400, corsHeaders);
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';

  const contactId = uuid();
  const convId = uuid();
  try {
    await env.DB.prepare(
      `INSERT INTO contacts (id, tenant_id, name, is_identified) VALUES (?, ?, ?, 0)`,
    ).bind(contactId, tenantId, '[admin-test]').run();
    await env.DB.prepare(
      `INSERT INTO conversations (id, tenant_id, contact_id, status) VALUES (?, ?, ?, 'bot')`,
    ).bind(convId, tenantId, contactId).run();

    // Synthesize a Request object and reuse the widget message path so we
    // exercise exactly the same flow / bonus-code / AI fallback chain as a
    // real customer would.
    const fakeReq = new Request('https://internal.test/admin-test-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_type: 'customer', content: text }),
    });
    const res = await sendMessage(fakeReq, env, corsHeaders, convId, { source: 'widget' }, ctx);
    const json = await res.json();
    await audit(env, request, 'admin.test_bot', { resource_type: 'conversation', resource_id: convId, payload: { input: text } });
    return ok({
      success: true,
      input: text,
      bot_reply: json.bot_reply || null,
      bot_replies: json.bot_replies || [],
    }, corsHeaders);
  } catch (e) {
    await logError(env, 'admin.test_bot', e, { input: text });
    return err('Test failed: ' + e.message, 500, corsHeaders);
  } finally {
    // Best-effort cleanup so admin tests don't pollute the message store.
    try {
      await env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(convId).run();
      await env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(convId).run();
      await env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(contactId).run();
    } catch (_) {}
  }
}

// --- GAS URL management. Lists each overridable key with current effective
// value (override or static env) + override status flags.
export async function listGasUrls(request, env, corsHeaders) {
  const out = [];
  const { results } = await env.DB.prepare(
    `SELECT key, value, updated_by, updated_at FROM env_overrides WHERE key IN (${OVERRIDABLE_KEYS.map(() => '?').join(',')})`,
  ).bind(...OVERRIDABLE_KEYS).all();
  const overrideMap = new Map((results || []).map((r) => [r.key, r]));
  for (const k of OVERRIDABLE_KEYS) {
    const ov = overrideMap.get(k);
    const fromEnv = typeof env[k] === 'string' && env[k] ? env[k] : '';
    out.push({
      key: k,
      effective_value: ov ? ov.value : fromEnv,
      has_override: !!ov,
      has_static_secret: !!fromEnv,
      override_updated_by: ov?.updated_by || null,
      override_updated_at: ov?.updated_at || null,
    });
  }
  return ok({ success: true, urls: out }, corsHeaders);
}

export async function setGasUrl(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const key = String(body?.key || '');
  const value = String(body?.value || '').trim();
  if (!OVERRIDABLE_KEYS.includes(key)) return err('Invalid key', 400, corsHeaders);

  const staffEmail = request?.__staff?.email || null;
  if (value === '') {
    await env.DB.prepare('DELETE FROM env_overrides WHERE key = ?').bind(key).run();
    clearEnvCache(key);
    await audit(env, request, 'gas_url.clear', { resource_type: 'env_override', resource_id: key });
    return ok({ success: true, cleared: true }, corsHeaders);
  }
  if (!/^https?:\/\//.test(value)) return err('Value must be a URL (http/https)', 400, corsHeaders);

  await env.DB.prepare(
    `INSERT INTO env_overrides (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')`,
  ).bind(key, value, staffEmail).run();
  clearEnvCache(key);
  await audit(env, request, 'gas_url.update', { resource_type: 'env_override', resource_id: key, payload: { value: value.slice(0, 80) } });
  return ok({ success: true }, corsHeaders);
}

// --- GAS ping. Sends a probe POST to one URL and returns the response
// status + body snippet. Body: { key: 'GAS_BOT_WEBHOOK_URL' }
export async function pingGasUrl(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const key = String(body?.key || '');
  if (!OVERRIDABLE_KEYS.includes(key)) return err('Invalid key', 400, corsHeaders);
  const url = await getEnvValue(env, key);
  if (!url) return err(`No URL configured for ${key}`, 404, corsHeaders);

  const probe = { event: 'admin_ping', source: 'sloten-standalone-admin', sent_at: new Date().toISOString() };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  let result;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probe),
      signal: ac.signal,
      redirect: 'follow',
    });
    const text = await r.text().catch(() => '');
    result = { ok: r.ok, status: r.status, body_snippet: text.slice(0, 500) };
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
  await audit(env, request, 'gas_url.ping', { resource_type: 'env_override', resource_id: key, payload: result });
  return ok({ success: true, result }, corsHeaders);
}

// --- Audit log reader.
export async function listAuditLog(request, env, corsHeaders) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 1000);
  const action = url.searchParams.get('action');
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  const where = ['tenant_id = ?'];
  const vals = [tenantId];
  if (action) { where.push('action LIKE ?'); vals.push(action + '%'); }
  vals.push(limit);
  const { results } = await env.DB.prepare(
    `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
  ).bind(...vals).all();
  return ok({ success: true, entries: results || [] }, corsHeaders);
}

// --- Error log reader.
export async function listErrorLog(request, env, corsHeaders) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const source = url.searchParams.get('source');
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  const where = ['tenant_id = ?'];
  const vals = [tenantId];
  if (source) { where.push('source = ?'); vals.push(source); }
  vals.push(limit);
  const { results } = await env.DB.prepare(
    `SELECT * FROM error_log WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
  ).bind(...vals).all();
  return ok({ success: true, entries: results || [] }, corsHeaders);
}

// --- Backup / Restore. Dumps editable config tables to a JSON document the
// admin can save locally. Restore replaces those tables (after confirm).
// Per-table row cap to keep the JSON response under Worker memory limits.
// Tables exceeding this report an error rather than silently truncating.
const BACKUP_ROW_LIMIT = 50000;

const BACKUP_TABLES = [
  'bot_flows',
  'bot_menus',
  'bonus_codes',
  'faq',
  'templates',
  'knowledge_sources',
  'labels',
  'teams',
  'env_overrides',
  'ai_prompts',
];

export async function adminBackup(request, env, corsHeaders) {
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  const out = { generated_at: new Date().toISOString(), tenant_id: tenantId, version: 1, tables: {} };
  for (const t of BACKUP_TABLES) {
    // Reject anything not in the strict whitelist (defence-in-depth, even
    // though the loop already iterates BACKUP_TABLES which is hardcoded).
    if (!/^[a-z_][a-z0-9_]{0,40}$/i.test(t)) {
      out.tables[t] = { __error: 'invalid table name' };
      continue;
    }
    try {
      const hasTenant = await env.DB.prepare(
        `SELECT name FROM pragma_table_info(?) WHERE name='tenant_id'`,
      ).bind(t).first();
      const limitClause = ` LIMIT ${BACKUP_ROW_LIMIT + 1}`;
      const sql = hasTenant
        ? `SELECT * FROM ${t} WHERE tenant_id = ? ORDER BY rowid${limitClause}`
        : `SELECT * FROM ${t} ORDER BY rowid${limitClause}`;
      const stmt = hasTenant ? env.DB.prepare(sql).bind(tenantId) : env.DB.prepare(sql);
      const { results } = await stmt.all();
      const rows = results || [];
      // Surface "too big to back up" cases instead of silently truncating.
      if (rows.length > BACKUP_ROW_LIMIT) {
        out.tables[t] = { __error: `row count exceeds backup limit of ${BACKUP_ROW_LIMIT}; export this table separately` };
      } else {
        out.tables[t] = rows;
      }
    } catch (e) {
      out.tables[t] = { __error: e.message };
    }
  }
  await audit(env, request, 'admin.backup', { resource_type: 'backup', payload: { tables: BACKUP_TABLES.length } });
  return new Response(JSON.stringify(out, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="sloten-backup-${Date.now()}.json"`,
      ...corsHeaders,
    },
  });
}

// Build a read-only tree of the bot's menu/flow structure for the admin
// "メニュー・メッセージ" viewer. Output shape mirrors the production
// chatwoot-bot /api/menus endpoint (admin-preview.html consumes this exact
// shape) so the same tree UI can be reused without divergence:
//
//   {
//     totalKeys: int,
//     stats: {...},
//     data: {
//       mainMenu: <node>,
//       bonusFlows: [<node>, ...],   // each bonus code as a root
//       other: [<node>, ...]         // unvisited utility steps
//     }
//   }
//
// Each node:
//   { key, label, contentPreview, content, itemCount, items:[{title,value}],
//     flags:{handoff_to_gasbot,handoff_to_bank_bot,handoff_to_ec_bot,transfer_to_agent},
//     children:[<node>], isRef? }
function detectFlags(step) {
  // Mirror production messages.js flags by inspecting the standalone step.
  // - handoff_to_gasbot: step or its descendants webhook to GAS_BOT_WEBHOOK_URL
  // - handoff_to_bank_bot: BANK_TRANSFER_BOT_WEBHOOK_URL
  // - handoff_to_ec_bot:   EC_DEPOSIT_BOT_WEBHOOK_URL
  // - transfer_to_agent:   step.type === 'handoff'
  const flags = { handoff_to_gasbot: false, handoff_to_bank_bot: false, handoff_to_ec_bot: false, transfer_to_agent: false };
  if (!step) return flags;
  if (step.type === 'handoff') flags.transfer_to_agent = true;
  // Heuristic by step id (keeps parity with production messages.js semantics).
  const id = step.id || '';
  if (id.startsWith('paypay_money')) flags.handoff_to_gasbot = true;
  else if (id.startsWith('bank_transfer')) flags.handoff_to_bank_bot = true;
  else if (id.startsWith('convenience_store_deposit')) flags.handoff_to_ec_bot = true;
  // Webhook URL inspection (catches anything explicit).
  if (step.type === 'webhook' && typeof step.url === 'string') {
    if (/GAS_BOT_WEBHOOK_URL/.test(step.url)) flags.handoff_to_gasbot = true;
    if (/BANK_TRANSFER_BOT_WEBHOOK_URL/.test(step.url)) flags.handoff_to_bank_bot = true;
    if (/EC_DEPOSIT_BOT_WEBHOOK_URL/.test(step.url)) flags.handoff_to_ec_bot = true;
  }
  return flags;
}

// Convert a bot_flow `select` step's options into production-format items.
// Production items are { title, value } only.
function stepItems(step) {
  if (!step || !Array.isArray(step.options)) return [];
  return step.options.map((o) => ({ title: o.title || '', value: o.value || '' }));
}

export async function adminMenuTree(request, env, corsHeaders) {
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  const flow = await env.DB.prepare(
    `SELECT * FROM bot_flows WHERE tenant_id = ? AND name = 'sloten-main' LIMIT 1`,
  ).bind(tenantId).first();
  let steps = [];
  try { steps = JSON.parse(flow?.steps || '[]'); } catch (_) { steps = []; }
  const stepsById = new Map(steps.map((s) => [s.id, s]));

  const visited = new Set();
  function makeNode(key, label) {
    const s = stepsById.get(key);
    if (!s) return null;
    if (visited.has(key)) return { key, label: label || key, isRef: true, children: [] };
    visited.add(key);

    const items = stepItems(s);
    const children = [];
    for (const item of items) {
      // Skip global back-links (production also does this).
      if (item.value === 'welcome_message' || item.value === 'transfer_to_agent') continue;
      if (/[↩⇔↔]/.test(item.title || '')) continue;
      if (!stepsById.has(item.value)) continue;
      const child = makeNode(item.value, item.title);
      if (child) children.push(child);
    }
    // Linear `next` chains (collect/message/webhook/handoff sequences in
    // deposit flows). Walk the chain and represent each step as a child so
    // the deposit sub-flows show up in the tree under their entry node.
    if (s.next && stepsById.has(s.next) && !visited.has(s.next)) {
      const next = makeNode(s.next, '(続き) ' + s.next);
      if (next) children.push(next);
    }

    const content = s.content || s.prompt || s.note || '';
    return {
      key,
      label: label || key,
      contentPreview: content.slice(0, 80),
      content,
      itemCount: items.length,
      items,
      flags: detectFlags(s),
      children,
    };
  }

  const mainMenu = makeNode('welcome_message', 'メインメニュー');

  // Bonus flows: each enabled bonus_codes row becomes a root node mirroring
  // production's *_success keys. The success message + items become the
  // node's content/items, AND for each item whose value points at a step
  // in bot_flows we recurse to surface the follow-up flow tree (e.g.
  // vamos_bonus_success → vamos_has_balance → vamos_game_*).
  const { results: codeRows } = await env.DB.prepare(
    `SELECT type_key, display_name, codes, match_mode, success_content, success_items, gas_type, enabled, source
       FROM bonus_codes WHERE tenant_id = ? AND enabled = 1 ORDER BY priority DESC, id ASC`,
  ).bind(tenantId).all();
  const bonusFlows = (codeRows || []).map((r) => {
    // bonus_codes.codes / success_items are TEXT (JSON-encoded). Parse with
    // labelled best-effort so corrupted rows are visible in logs (catch (_) {}
    // previously would have silently treated as empty arrays).
    let codes = bestEffortSync('admin-ops:menu-tree:codes', () => JSON.parse(r.codes)) || [];
    let items = bestEffortSync('admin-ops:menu-tree:success_items', () => JSON.parse(r.success_items)) || [];
    items = (Array.isArray(items) ? items : []).map((it) => ({ title: it.title || '', value: it.value || '' }));
    const codeLabel = codes.length ? ` [${codes[0]}${codes.length > 1 ? '+' + (codes.length - 1) : ''}]` : '';
    const content = r.success_content || '';
    // Walk into bot_flows steps for each item.value (the bonus follow-up
    // flows: vamos_has_balance, stepup_game_selected, etc.). Skip global
    // back-links + already-visited keys to avoid loops.
    const children = [];
    for (const it of items) {
      const v = it.value;
      if (!v || v === 'welcome_message' || v === 'transfer_to_agent') continue;
      if (/[↩⇔↔]/.test(it.title || '')) continue;
      if (!stepsById.has(v) || visited.has(v)) continue;
      const child = makeNode(v, it.title);
      if (child) children.push(child);
    }
    return {
      key: r.type_key,
      label: r.display_name + codeLabel,
      contentPreview: content.split('\n').filter(l => l.trim())[0]?.slice(0, 80) || '',
      content,
      itemCount: items.length,
      items,
      flags: {
        handoff_to_gasbot: false,
        handoff_to_bank_bot: false,
        handoff_to_ec_bot: false,
        transfer_to_agent: false,
        bonus_code: true,           // standalone-only flag, UI shows as 🎟️ badge
        gas_forward: !!r.gas_type,  // implies forwarding to BONUS_CODE_WEBHOOK_URL
        gas_type: r.gas_type || null,
        match_mode: r.match_mode,
        codes,
      },
      children,
    };
  });

  // Other unvisited steps (utility / error handlers / submit / done).
  const other = [];
  for (const s of steps) {
    if (visited.has(s.id)) continue;
    const content = s.content || s.prompt || s.note || '';
    other.push({
      key: s.id,
      label: s.id,
      contentPreview: content.slice(0, 80),
      content,
      itemCount: Array.isArray(s.options) ? s.options.length : 0,
      items: stepItems(s),
      flags: detectFlags(s),
      children: [],
    });
  }

  // Stats.
  let staticGasCount = 0;
  for (const k of ['GAS_BOT_WEBHOOK_URL','BANK_TRANSFER_BOT_WEBHOOK_URL','EC_DEPOSIT_BOT_WEBHOOK_URL','BONUS_CODE_WEBHOOK_URL']) {
    if (typeof env[k] === 'string' && env[k]) staticGasCount++;
  }
  const flowCount = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM bot_flows WHERE tenant_id = ? AND is_active = 1`,
  ).bind(tenantId).first();

  return ok({
    success: true,
    totalKeys: steps.length,
    stats: {
      menu_steps: steps.length,
      bonus_codes: codeRows?.length || 0,
      bonus_codes_enabled: codeRows?.length || 0,
      gas_urls_configured: staticGasCount,
      flows_active: flowCount?.n || 0,
    },
    data: { mainMenu, bonusFlows, other },
  }, corsHeaders);
}

// Restore: replaces rows in a single named table. Body: { table, rows }.
// Safer than restoring everything in one shot — the admin reviews per-table.
export async function adminRestore(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const table = String(body?.table || '');
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!BACKUP_TABLES.includes(table)) return err('Invalid table', 400, corsHeaders);
  // Defence-in-depth: SQLite cannot parameterize table/column names, so we
  // enforce a strict identifier regex ON TOP OF the BACKUP_TABLES whitelist.
  // This blocks any hypothetical future expansion that might add an unsafe
  // table name to the whitelist.
  if (!/^[a-z_][a-z0-9_]{0,40}$/i.test(table)) return err('Invalid table name format', 400, corsHeaders);
  if (!rows) return err('rows must be an array', 400, corsHeaders);
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  try {
    // Look up the actual columns of the target table and use that as the
    // whitelist for any column name we accept from the upload. Without this,
    // a malicious admin (or a tampered backup file) could inject arbitrary
    // SQL via the `cols` array.
    const { results: colRows } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info(?)`,
    ).bind(table).all();
    const allowedCols = new Set((colRows || []).map((c) => c.name));
    if (!allowedCols.size) return err('Table not found in schema', 404, corsHeaders);
    const hasTenant = allowedCols.has('tenant_id');

    // Build all statements first, then execute via DB.batch() for atomicity.
    // If any statement fails the entire batch rolls back — no risk of an
    // empty table from a mid-restore crash (the original non-batch approach
    // was flagged as a P1 data-safety issue in the audit).
    const stmts = [];
    if (hasTenant) {
      stmts.push(env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId));
    } else {
      stmts.push(env.DB.prepare(`DELETE FROM ${table}`));
    }
    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      const cols = Object.keys(r).filter((k) => k !== 'rowid' && allowedCols.has(k));
      if (cols.length !== Object.keys(r).filter((k) => k !== 'rowid').length) skipped++;
      if (!cols.length) continue;
      const placeholders = cols.map(() => '?').join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;
      stmts.push(env.DB.prepare(sql).bind(...cols.map((c) => r[c])));
      inserted++;
    }
    // D1 batch() executes all statements in a single implicit transaction.
    await env.DB.batch(stmts);
    await audit(env, request, 'admin.restore', { resource_type: table, payload: { inserted, skipped } });
    return ok({ success: true, table, inserted, columns_dropped: skipped }, corsHeaders);
  } catch (e) {
    await logError(env, 'admin.restore', e, { table });
    return err('リストアに失敗しました。エラーログをご確認ください。', 500, corsHeaders);
  }
}
