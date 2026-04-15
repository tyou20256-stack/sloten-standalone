#!/usr/bin/env node
// Import recent conversations/messages/contacts from a Chatwoot instance
// into sloten-standalone's D1. Idempotent via external_id keys.
//
// Usage:
//   node scripts/import-chatwoot.mjs --days 7 [--dry-run] [--limit 500] \
//     [--config=wrangler.staging-bk.toml] [--no-include-bot]
//
// Env / files:
//   CHATWOOT_BASE_URL         default https://im.sloten.io
//   CHATWOOT_ACCOUNT_ID       default 3
//   C:/tmp/cw_token.txt       Chatwoot api_access_token (required)

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const p = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!p) return def;
  if (p.includes('=')) return p.split('=').slice(1).join('=');
  const i = argv.indexOf(p);
  return argv[i + 1] || def;
};
const has = (name) => argv.includes(`--${name}`);

const DAYS = parseInt(arg('days', '7'), 10);
const DRY = has('dry-run');
const LIMIT = parseInt(arg('limit', '2000'), 10);
const INCLUDE_BOT = !has('no-include-bot');
const CONFIG = arg('config', 'wrangler.staging-bk.toml');
const BASE = (process.env.CHATWOOT_BASE_URL || 'https://im.sloten.io').replace(/\/$/, '');
const ACCOUNT_ID = parseInt(process.env.CHATWOOT_ACCOUNT_ID || '3', 10);
const DB = 'sloten_standalone_db_staging_bk';

const TOKEN = readFileSync('C:/tmp/cw_token.txt', 'utf8').trim();
const SINCE = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
const SINCE_MS = SINCE.getTime();

console.log(`import-chatwoot: base=${BASE} account=${ACCOUNT_ID} since=${SINCE.toISOString()} dry=${DRY} include_bot=${INCLUDE_BOT}`);

async function api(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { api_access_token: TOKEN } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

function sqlEscape(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function jsonEscape(obj) {
  if (obj == null) return 'NULL';
  return sqlEscape(JSON.stringify(obj));
}
function isoFromUnix(sec) {
  if (!sec) return null;
  return new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}
function mapStatus(cwStatus) {
  if (cwStatus === 'open') return 'open';
  if (cwStatus === 'resolved') return 'closed';
  if (cwStatus === 'pending') return 'bot';
  return 'bot';
}
function mapSenderType(m) {
  // message_type: 0=incoming (from contact), 1=outgoing (to contact), 2=activity, 3=template
  if (m.message_type === 2) return 'system';
  const st = m.sender_type; // Contact / User / AgentBot
  if (st === 'Contact') return 'customer';
  if (st === 'AgentBot') return 'bot';
  if (st === 'User') return 'staff';
  return m.message_type === 0 ? 'customer' : 'staff';
}

// --- Fetch ---
const stopBefore = SINCE_MS;
const convs = [];
let page = 1, totalScanned = 0;
outer: while (convs.length < LIMIT) {
  const res = await api(`/api/v1/accounts/${ACCOUNT_ID}/conversations?page=${page}&assignee_type=all&status=all`);
  const payload = res?.data?.payload || [];
  if (payload.length === 0) break;
  for (const c of payload) {
    totalScanned++;
    const last = (c.last_activity_at || c.timestamp || c.created_at || 0) * 1000;
    if (last && last < stopBefore) {
      // conversations are ordered by last_activity_at desc, safe to stop
      break outer;
    }
    convs.push(c);
    if (convs.length >= LIMIT) break outer;
  }
  page++;
  if (page > 100) break; // safety cap
}
console.log(`fetched ${convs.length} conversations (scanned ${totalScanned})`);

// Collect contact + message details per conversation
const contactById = new Map(); // cw_id -> { name,email,phone,... }
const messagesByConv = new Map(); // cw_conv_id -> [msg...]
let msgCount = 0;

for (const c of convs) {
  const senderId = c?.meta?.sender?.id;
  if (senderId && !contactById.has(senderId)) {
    const s = c.meta.sender;
    contactById.set(senderId, {
      id: s.id,
      name: s.name || null,
      email: s.email || null,
      phone: s.phone_number || null,
      identifier: s.identifier || null,
      additional_attributes: s.additional_attributes || null,
    });
  }
  // Messages — Chatwoot returns first page only via conversation endpoint; fetch explicitly.
  try {
    const mr = await api(`/api/v1/accounts/${ACCOUNT_ID}/conversations/${c.id}/messages`);
    const msgs = mr?.data?.payload || mr?.payload || [];
    messagesByConv.set(c.id, msgs);
    msgCount += msgs.length;
  } catch (e) {
    console.warn(`  ! messages fetch failed conv=${c.id}: ${e.message}`);
    messagesByConv.set(c.id, []);
  }
}
console.log(`collected ${contactById.size} contacts, ${msgCount} messages`);

if (DRY) {
  console.log('=== DRY RUN: no DB writes ===');
  console.log(`  contacts:       ${contactById.size}`);
  console.log(`  conversations:  ${convs.length}`);
  console.log(`  messages:       ${msgCount}`);
  const botMsgs = [...messagesByConv.values()].flat().filter((m) => m.sender_type === 'AgentBot').length;
  const staffMsgs = [...messagesByConv.values()].flat().filter((m) => m.sender_type === 'User' && m.message_type === 1).length;
  console.log(`  (bot: ${botMsgs}, staff: ${staffMsgs})`);
  process.exit(0);
}

// --- Resolve staff by email (best-effort) ---
// Pull existing staff_members into a local map for assignee resolution.
const staffJson = execSync(
  `wrangler d1 execute ${DB} --config=${CONFIG} --remote --json --command "SELECT id, email FROM staff_members"`,
  { encoding: 'utf8' }
);
const staffRows = JSON.parse(staffJson)[0]?.results || [];
const staffByEmail = new Map(staffRows.map((r) => [r.email.toLowerCase(), r.id]));
console.log(`resolved ${staffByEmail.size} staff by email`);

// --- Build SQL ---
const CW = `chatwoot:${ACCOUNT_ID}`;
const sqlLines = [];

// Contacts upsert
for (const [cwId, c] of contactById) {
  const extId = `${CW}:contact:${cwId}`;
  const meta = {
    chatwoot_contact_id: cwId,
    chatwoot_identifier: c.identifier,
    ...(c.additional_attributes || {}),
  };
  // Look up existing; if none, insert new UUID. Do this per-row at exec time via SQL UPSERT.
  // We key on external_id (UNIQUE WHERE NOT NULL). For insert we need a fresh UUID id.
  const id = randomUUID();
  const isIdent = (c.email || c.phone) ? 1 : 0;
  sqlLines.push(
    `INSERT INTO contacts (id, tenant_id, email, phone, name, metadata, is_identified, external_id) VALUES ` +
    `(${sqlEscape(id)}, 'tenant_default', ${sqlEscape(c.email)}, ${sqlEscape(c.phone)}, ${sqlEscape(c.name)}, ${jsonEscape(meta)}, ${isIdent}, ${sqlEscape(extId)}) ` +
    `ON CONFLICT(external_id) DO UPDATE SET ` +
    `name = excluded.name, email = excluded.email, phone = excluded.phone, metadata = excluded.metadata, is_identified = excluded.is_identified, updated_at = datetime('now');`
  );
}

// Conversations upsert
for (const c of convs) {
  const extId = `${CW}:conv:${c.id}`;
  const contactExtId = c?.meta?.sender?.id ? `${CW}:contact:${c.meta.sender.id}` : null;
  if (!contactExtId) continue; // skip conversations without a contact
  const status = mapStatus(c.status);
  const assigneeEmail = c?.meta?.assignee?.email?.toLowerCase() || null;
  const assigneeId = assigneeEmail ? (staffByEmail.get(assigneeEmail) ?? null) : null;
  const meta = {
    chatwoot_conversation_id: c.id,
    chatwoot_status: c.status,
    chatwoot_inbox_id: c.inbox_id,
    chatwoot_assignee_email: assigneeEmail,
    chatwoot_labels: c.labels || [],
  };
  const lastAt = isoFromUnix(c.last_activity_at);
  const createdAt = isoFromUnix(c.created_at);
  const closedAt = c.status === 'resolved' ? (isoFromUnix(c.last_activity_at) || null) : null;
  const labelsCsv = (c.labels || []).join(',');
  const id = randomUUID();

  sqlLines.push(
    `INSERT INTO conversations (id, tenant_id, contact_id, status, assignee_id, last_message_at, last_message_preview, metadata, priority, labels, external_id, created_at, closed_at) VALUES ` +
    `(${sqlEscape(id)}, 'tenant_default', (SELECT id FROM contacts WHERE external_id = ${sqlEscape(contactExtId)}), ` +
    `${sqlEscape(status)}, ${assigneeId == null ? 'NULL' : assigneeId}, ${sqlEscape(lastAt)}, ` +
    `${sqlEscape((c?.last_non_activity_message?.content || '').slice(0, 200))}, ${jsonEscape(meta)}, 'normal', ${sqlEscape(labelsCsv)}, ${sqlEscape(extId)}, ` +
    `${sqlEscape(createdAt || null)}, ${sqlEscape(closedAt)}) ` +
    `ON CONFLICT(external_id) DO UPDATE SET ` +
    `status = excluded.status, assignee_id = excluded.assignee_id, last_message_at = excluded.last_message_at, ` +
    `last_message_preview = excluded.last_message_preview, metadata = excluded.metadata, labels = excluded.labels, closed_at = excluded.closed_at, updated_at = datetime('now');`
  );
}

// Messages upsert
let msgSkipped = 0;
for (const [cwConvId, msgs] of messagesByConv) {
  const convExtId = `${CW}:conv:${cwConvId}`;
  for (const m of msgs) {
    const senderType = mapSenderType(m);
    if (!INCLUDE_BOT && senderType === 'bot') { msgSkipped++; continue; }
    if (!m.content && m.message_type !== 2) { msgSkipped++; continue; }
    const extId = `${CW}:msg:${m.id}`;
    const id = randomUUID();
    const isPrivate = m.private ? 1 : 0;
    const attrs = m.content_attributes ? m.content_attributes : null;
    const contentType = m.content_type === 'input_select' ? 'input_select' :
                        m.message_type === 2 ? 'system_event' : 'text';
    const createdAt = isoFromUnix(m.created_at);

    sqlLines.push(
      `INSERT INTO messages (id, conversation_id, tenant_id, sender_type, sender_id, content, content_type, content_attributes, is_private, external_id, created_at) VALUES ` +
      `(${sqlEscape(id)}, (SELECT id FROM conversations WHERE external_id = ${sqlEscape(convExtId)}), 'tenant_default', ` +
      `${sqlEscape(senderType)}, ${sqlEscape(m.sender?.email || (m.sender?.id ? String(m.sender.id) : null))}, ` +
      `${sqlEscape(m.content || '')}, ${sqlEscape(contentType)}, ${jsonEscape(attrs)}, ${isPrivate}, ${sqlEscape(extId)}, ${sqlEscape(createdAt)}) ` +
      `ON CONFLICT(external_id) DO UPDATE SET content = excluded.content, content_attributes = excluded.content_attributes;`
    );
  }
}

console.log(`built ${sqlLines.length} SQL statements (skipped ${msgSkipped} messages)`);

// Chunk SQL into files to avoid command-line size limits.
const CHUNK = 200;
let applied = 0;
const tmp = `.import-${Date.now()}.sql`;
for (let i = 0; i < sqlLines.length; i += CHUNK) {
  const slice = sqlLines.slice(i, i + CHUNK).join('\n');
  writeFileSync(tmp, slice, 'utf8');
  process.stdout.write(`  apply ${i + 1}-${Math.min(i + CHUNK, sqlLines.length)}/${sqlLines.length} ... `);
  try {
    execSync(`wrangler d1 execute ${DB} --config=${CONFIG} --remote --file=${tmp}`, { stdio: 'pipe' });
    applied += slice.split('\n').length;
    console.log('OK');
  } catch (e) {
    console.log('FAIL');
    console.error(e.stdout?.toString() || e.message);
  }
}
try { execSync(`rm -f ${tmp}`); } catch (_) {}

console.log('=== IMPORT DONE ===');
console.log(`  contacts:       ${contactById.size}`);
console.log(`  conversations:  ${convs.length}`);
console.log(`  messages:       ${msgCount - msgSkipped} (skipped ${msgSkipped})`);
console.log(`  sql applied:    ${applied}/${sqlLines.length}`);
