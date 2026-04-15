#!/usr/bin/env node
// Extract Q&A pairs from imported conversations (customer message -> next
// staff message in the same conversation) and generate a FAQ seed SQL.
//
// Filters out deposit-related questions per business requirement: those are
// served by the bot flow (GAS integration), not by the AI.
//
// Usage:
//   node scripts/extract-faqs-from-messages.mjs [--limit 300] [--out seeds/seed-faq-from-history.sql]
//
// Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env; queries
// sloten_standalone_db_staging_bk via wrangler d1 execute --json.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const LIMIT = parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '300', 10);
const OUT = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'seeds/seed-faq-from-history.sql';
const DB = 'sloten_standalone_db_staging_bk';
const CONFIG = 'wrangler.staging-bk.toml';

// Deposit / withdrawal / payment keywords — questions that include these are
// routed to the GAS flow and must NOT be learned by the AI.
const DEPOSIT_KEYWORDS = [
  '入金', '出金', '振込', '送金', '入出金', '支払', '支払い', '決済', '着金',
  'PayPay', 'ペイペイ', 'LinePay', 'ライン', '銀行振込', '銀行',
  'Amazon', 'アマゾン', 'amazonギフト', 'ギフト券', 'ビットコイン', '仮想通貨',
  '振り込', '返金', 'チャージ', '反映', 'ボーナスコード',
];
const DEPOSIT_RE = new RegExp('(?:' + DEPOSIT_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');

// PII masking (simplified — matches src/pii-masker.mjs)
function maskPII(s) {
  if (!s) return '';
  return String(s)
    .replace(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/0[789]0[-\s]?\d{4}[-\s]?\d{4}/g, '[PHONE]')
    .replace(/\b\d{12,18}\b/g, '[ACCT]')
    .replace(/¥\s?\d{1,3}(?:,?\d{3})*/g, '¥[AMT]')
    .replace(/\d{1,3}(?:,\d{3})+\s*円/g, '[AMT]円');
}

function normalize(s) {
  return String(s).replace(/\s+/g, ' ').replace(/[!！?？。、「」『』()（）\[\]【】,.…]/g, '').trim();
}
// Cluster key: first 24 normalized chars + presence of a few topic markers.
function clusterKey(q) {
  const n = normalize(q);
  return n.slice(0, 24);
}
function categorize(q) {
  const n = q;
  if (/アカウント|登録|ログイン|パスワード|メアド|メール|電話番号/i.test(n)) return 'アカウント';
  if (/ボーナス|キャンペーン|特典|プロモ/i.test(n)) return 'ボーナス';
  if (/ゲーム|スロット|プレイ|スピン|ジャックポット/i.test(n)) return 'ゲーム';
  if (/KYC|本人確認|身分証|免許|パスポート|住所|証明/i.test(n)) return '本人確認';
  if (/VIP|ランク|還元/i.test(n)) return 'VIP';
  if (/退会|解約|停止|ブロック/i.test(n)) return 'アカウント';
  return '一般';
}

const D1_DB_ID = 'f0965b48-9cf3-4955-a870-a5d134849611';
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '13efd242bd7a9513690ebabcb66529ba';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!CF_TOKEN) { console.error('CLOUDFLARE_API_TOKEN not set'); process.exit(1); }

async function runQueryJson(sql) {
  // wrangler --file mode returns only execution summary for SELECTs. Use the
  // direct D1 REST API instead — it returns the actual row data.
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_DB_ID}/query`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const data = await r.json();
  if (!data.success) throw new Error('D1 API error: ' + JSON.stringify(data.errors || data));
  return data.result?.[0]?.results || [];
}

function sqlEscape(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

console.log('Fetching messages from D1 (in chunks to avoid timeouts)…');
// D1 correlated subqueries on 35K rows time out; fetch raw messages and pair
// them in memory instead. Pull in chunks by created_at ascending.
const CHUNK = 5000;
let allMsgs = [];
let lastTs = '1970-01-01 00:00:00';
for (let i = 0; i < 20; i++) {
  const chunkSql = `
    SELECT id, conversation_id, sender_type, is_private, content, created_at
      FROM messages
     WHERE is_private = 0
       AND sender_type IN ('customer','staff')
       AND created_at > '${lastTs}'
     ORDER BY created_at ASC
     LIMIT ${CHUNK}`;
  const part = await runQueryJson(chunkSql);
  if (part.length === 0) break;
  allMsgs = allMsgs.concat(part);
  lastTs = part[part.length - 1].created_at;
  process.stdout.write(`  chunk ${i + 1}: +${part.length} (total ${allMsgs.length}) lastTs=${lastTs}\n`);
  if (part.length < CHUNK) break;
}
console.log(`Fetched ${allMsgs.length} messages total`);

// Group by conversation
const byConv = new Map();
for (const m of allMsgs) {
  let arr = byConv.get(m.conversation_id);
  if (!arr) { arr = []; byConv.set(m.conversation_id, arr); }
  arr.push(m);
}

// Pair: for each customer message, find the next staff message.
const rows = [];
for (const [, msgs] of byConv) {
  for (let i = 0; i < msgs.length; i++) {
    const c = msgs[i];
    if (c.sender_type !== 'customer') continue;
    if (!c.content || c.content.length < 5 || c.content.length > 300) continue;
    for (let j = i + 1; j < msgs.length; j++) {
      if (msgs[j].sender_type === 'staff' && msgs[j].content && msgs[j].content.length >= 5) {
        rows.push({ question: c.content, answer: msgs[j].content });
        break;
      }
    }
  }
}
console.log(`  ${rows.length} customer→staff Q&A pairs assembled`);

const clusters = new Map(); // key -> { question, answer, count }
let kept = 0, depositSkipped = 0, noAnswer = 0;

for (const r of rows) {
  if (!r.answer) { noAnswer++; continue; }
  const q = maskPII(r.question);
  const a = maskPII(r.answer);
  if (q.length < 5 || a.length < 5) continue;
  if (DEPOSIT_RE.test(q) || DEPOSIT_RE.test(a)) { depositSkipped++; continue; }
  const key = clusterKey(q);
  if (!key) continue;
  const existing = clusters.get(key);
  if (existing) {
    existing.count++;
    // Keep the longest answer seen (often more informative).
    if (a.length > (existing.answer?.length || 0)) existing.answer = a;
  } else {
    clusters.set(key, { question: q, answer: a, count: 1 });
  }
  kept++;
}

console.log(`  kept ${kept} (no-answer: ${noAnswer}, deposit-filtered: ${depositSkipped})`);
console.log(`  -> ${clusters.size} unique clusters`);

// Rank by count, take top N.
const top = [...clusters.values()]
  .sort((a, b) => b.count - a.count)
  .slice(0, LIMIT);

console.log(`Top cluster frequencies: ${top.slice(0, 5).map((t) => t.count).join(', ')} …`);

// Emit SQL. Use category = derived, priority = count (so top FAQs surface
// first in the AI context).
const lines = [
  '-- @idempotent — seed-faq-from-history.sql',
  `-- Generated from ${rows.length} customer messages, ${clusters.size} unique clusters, top ${top.length} emitted.`,
  `-- Deposit-related Q&A filtered (${depositSkipped} excluded) — those are handled by GAS flows.`,
  '',
  `DELETE FROM faq WHERE tenant_id = 'tenant_default' AND category IN ('一般','アカウント','ボーナス','ゲーム','本人確認','VIP') AND keywords = 'auto-extracted';`,
  '',
];
for (const e of top) {
  const cat = categorize(e.question);
  const keywords = 'auto-extracted';
  lines.push(
    `INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES (` +
    `'tenant_default', ${sqlEscape(e.question.slice(0, 500))}, ${sqlEscape(e.answer.slice(0, 2000))}, ` +
    `${sqlEscape(cat)}, 'ja', ${sqlEscape(keywords)}, ${e.count}, 1);`
  );
}
writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`Wrote ${OUT} (${lines.length} lines)`);
