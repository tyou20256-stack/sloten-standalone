#!/usr/bin/env node
// Extract Q&A training data from Chatwoot conversation history imported into
// D1. Filters out deposit/bonus/transactional content, clusters by topic,
// and generates FAQ + knowledge_sources entries.
//
// Phase 1: Rule-based extraction (immediate)
// Phase 2: LLM synthesis via Gemini (optional, for higher quality)
//
// Usage:
//   node scripts/extract-training-data.mjs                  # dry-run
//   node scripts/extract-training-data.mjs --apply          # insert into D1
//   node scripts/extract-training-data.mjs --apply --llm    # + Gemini synthesis

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const APPLY = process.argv.includes('--apply');
const USE_LLM = process.argv.includes('--llm');
const TMP_SQL = 'seeds/_training-data.sql';

// ---- Filters (same as extractor.mjs) ----
const DEPOSIT_RE = /入金|出金|振込|送金|入出金|支払|支払い|決済|着金|PayPay|ペイペイ|LinePay|ライン|銀行振込|銀行|Amazon|アマゾン|ギフト券|ビットコイン|仮想通貨|振り込|返金|チャージ|反映|ボーナスコード/i;
const TRANSACTIONAL_RE = /取引番号|取引ID|注文番号|決済番号|申請番号|受付番号|アカウントID|ユーザーID|ユーザー名|ID入力|スクリーンショット|スクショ|画像添付|完了画面|決済画面/i;
const LONG_DIGIT_RE = /\b\d{15,}\b/;
const ACCOUNT_ID_RE = /\b(?=[A-Za-z0-9_-]{3,20}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/;
const AMOUNT_RE = /(?:¥\s?\d{1,3}(?:,?\d{3})*|\d{1,3}(?:,\d{3})+\s*円|\d{3,}\s*円)/;
const BONUS_CODE_RE = /スペシャルステップ|バモスイボナ|あけおめ|スペシャルチャンス|特別ステップ|特別ヘブンズ|カスタムヘブンズ|トライアスロン|ひな祭り|ヘブンズミッション|ヘブンズウィン|ELITE参加|ホワイトデー|ゾロ目チャレンジ|スロ天ドリーム|ゲートリアン|リリシア|ルシフィーレ|ハルピナ|アークエル|ラフィエル|セレフィム|SAKURA2026/i;

function shouldReject(q, a) {
  const joined = `${q}\n${a}`;
  if (DEPOSIT_RE.test(joined)) return 'deposit';
  if (TRANSACTIONAL_RE.test(joined)) return 'transactional';
  if (LONG_DIGIT_RE.test(joined)) return 'long_digit';
  if (ACCOUNT_ID_RE.test(joined)) return 'account_id';
  if (AMOUNT_RE.test(joined)) return 'amount';
  if (BONUS_CODE_RE.test(joined)) return 'bonus_code';
  // Menu navigation noise
  if (/^(メニュー|welcome_message|deposit_withdrawal|deposit_methods|game_info|bonus_promo|faq_main|account_issues|transfer_to_agent)$/i.test(q.trim())) return 'menu_nav';
  // Social pleasantries (not real questions)
  if (/^(ありがとう|よろしく|おはよう|こんにちは|こんばんは|すみません|はい$|了解|わかりました|お願いします$|OK$)/i.test(q.trim())) return 'pleasantry';
  // Question is or starts with a masked value (phone/email was sent as the message)
  if (/^\[PHONE\]|^\[EMAIL\]|^\[ID\]|^\d{6,}$/.test(q.trim())) return 'pii_only';
  // Answer is bot welcome/transfer (not a real staff answer)
  if (/スロット天国カスタマーサポートへようこそ|オペレーターにお繋ぎします|ご希望の項目を下記メニュー/.test(a)) return 'bot_answer';
  // Too short to be useful
  if (a.length < 20) return 'answer_too_short';
  return null;
}

function maskPII(s) {
  return String(s || '')
    .replace(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/0[789]0[-\s]?\d{4}[-\s]?\d{4}/g, '[PHONE]')
    .replace(/\b\d{12,}\b/g, '[ID]')
    .replace(/¥\s?\d{1,3}(?:,?\d{3})*/g, '¥[AMT]')
    .replace(/\d{1,3}(?:,\d{3})+\s*円/g, '[AMT]円');
}

function categorize(q) {
  if (/アカウント|登録|ログイン|パスワード|メール|電話番号/i.test(q)) return 'アカウント';
  if (/ボーナス|キャンペーン|特典|プロモ|フリースピン|FS|賭け条件|ターンオーバー/i.test(q)) return 'ボーナス';
  if (/ゲーム|スロット|プレイ|スピン|ジャックポット|機種/i.test(q)) return 'ゲーム';
  if (/KYC|本人確認|身分証|免許|パスポート|住所|証明/i.test(q)) return '本人確認';
  if (/VIP|ランク|還元|リベート/i.test(q)) return 'VIP';
  if (/退会|解約|停止|ブロック|凍結|自己規制/i.test(q)) return 'アカウント';
  if (/出金|引出|withdrawal/i.test(q)) return '出金';
  if (/サポート|問い合わせ|営業時間|対応時間/i.test(q)) return 'サポート';
  return '一般';
}

// ---- Fetch conversations ----
console.log('Fetching conversations...');

// Get all customer→staff message pairs grouped by conversation
const pairsRaw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT conversation_id, sender_type, content, created_at FROM messages WHERE is_private=0 AND sender_type IN ('customer','staff') AND content IS NOT NULL AND LENGTH(content) > 3 ORDER BY conversation_id, created_at ASC"`,
  { stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 },
).toString();

const allMsgs = JSON.parse(pairsRaw)[0]?.results || [];
console.log(`Total messages: ${allMsgs.length}`);

// Group by conversation
const byConv = new Map();
for (const m of allMsgs) {
  if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
  byConv.get(m.conversation_id).push(m);
}
console.log(`Conversations: ${byConv.size}`);

// Extract Q&A pairs
const pairs = [];
const stats = { total: 0, rejected: 0, accepted: 0, reasons: {} };
for (const [convId, msgs] of byConv) {
  for (let i = 0; i < msgs.length; i++) {
    const c = msgs[i];
    if (c.sender_type !== 'customer') continue;
    const q = (c.content || '').trim();
    if (q.length < 8 || q.length > 500) continue;
    // Find the next staff reply
    let staffReply = null;
    for (let j = i + 1; j < msgs.length && j <= i + 5; j++) {
      if (msgs[j].sender_type === 'staff' && (msgs[j].content || '').trim().length >= 10) {
        staffReply = msgs[j];
        break;
      }
    }
    if (!staffReply) continue;
    stats.total++;
    const a = (staffReply.content || '').trim();
    const reason = shouldReject(q, a);
    if (reason) {
      stats.rejected++;
      stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
      continue;
    }
    stats.accepted++;
    pairs.push({
      question: maskPII(q),
      answer: maskPII(a),
      category: categorize(q),
      convId,
    });
  }
}
console.log(`\nExtraction stats:`, stats);

// ---- Cluster by similar questions ----
function normalize(s) {
  return s.replace(/[\s!！?？。、「」『』()（）\[\]【】,.…]/g, '').toLowerCase().slice(0, 30);
}

const clusters = new Map();
for (const p of pairs) {
  const key = normalize(p.question);
  if (!key || key.length < 3) continue;
  if (!clusters.has(key)) clusters.set(key, { ...p, count: 1 });
  else {
    const c = clusters.get(key);
    c.count++;
    // Keep longer answer
    if (p.answer.length > c.answer.length) c.answer = p.answer;
  }
}

// Sort by frequency + answer quality
const ranked = [...clusters.values()]
  .filter(c => c.answer.length >= 15)
  .sort((a, b) => b.count - a.count || b.answer.length - a.answer.length);

console.log(`Clusters: ${clusters.size}, after quality filter: ${ranked.length}`);
console.log(`\nTop 10 by frequency:`);
for (const c of ranked.slice(0, 10)) {
  console.log(`  [${c.count}x] ${c.category.padEnd(8)} ${c.question.slice(0, 40)} → ${c.answer.slice(0, 50)}`);
}

// ---- Generate FAQ entries ----
// Take top clusters that appear 2+ times (higher confidence)
const faqEntries = ranked.filter(c => c.count >= 2).slice(0, 200);
// Also single-occurrence entries with high-quality answers (>50 chars)
const singleGood = ranked.filter(c => c.count === 1 && c.answer.length > 80).slice(0, 100);
const allFaq = [...faqEntries, ...singleGood];

console.log(`\nFAQ entries to insert: ${allFaq.length} (${faqEntries.length} frequent + ${singleGood.length} quality singles)`);

// ---- Generate knowledge_sources entries ----
// Group by category and create summary knowledge entries
const kbByCategory = new Map();
for (const c of ranked.slice(0, 300)) {
  if (!kbByCategory.has(c.category)) kbByCategory.set(c.category, []);
  kbByCategory.get(c.category).push(c);
}

const kbEntries = [];
for (const [cat, items] of kbByCategory) {
  if (items.length < 3) continue;
  const content = items.slice(0, 30).map(item =>
    `Q: ${item.question}\nA: ${item.answer}`
  ).join('\n\n---\n\n');
  kbEntries.push({
    title: `${cat} — 会話履歴から抽出したQ&A集 (${items.length}件)`,
    content: content.slice(0, 8000),
    category: cat === '一般' ? 'general' : cat === 'ゲーム' ? 'faq' : cat === 'アカウント' ? 'faq' : cat === 'ボーナス' ? 'campaign' : 'general',
    priority: items.length >= 10 ? 4 : 3,
  });
}
console.log(`Knowledge entries: ${kbEntries.length} categories`);

// ---- Get existing FAQ count to avoid too many dupes ----
const existingRaw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT COUNT(*) as n FROM faq WHERE tenant_id='tenant_default' AND is_active=1"`,
  { stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 },
).toString();
const existingCount = JSON.parse(existingRaw)[0]?.results?.[0]?.n || 0;
console.log(`\nExisting active FAQ: ${existingCount}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to insert.');
  process.exit(0);
}

// ---- Insert FAQ ----
const esc = s => String(s || '').replace(/'/g, "''");
const sqlLines = [];

for (const f of allFaq) {
  sqlLines.push(
    `INSERT INTO faq (tenant_id, question, answer, category, priority, is_active)
     SELECT 'tenant_default', '${esc(f.question)}', '${esc(f.answer)}', '${esc(f.category)}',
            ${f.count >= 3 ? 2 : 1}, 1
     WHERE NOT EXISTS (
       SELECT 1 FROM faq WHERE tenant_id='tenant_default'
         AND SUBSTR(question,1,30) = '${esc(f.question.slice(0, 30))}'
     );`
  );
}

// ---- Insert knowledge_sources ----
for (const kb of kbEntries) {
  sqlLines.push(
    `INSERT INTO knowledge_sources (tenant_id, title, content, source_type, priority, category, is_active)
     SELECT 'tenant_default', '${esc(kb.title)}', '${esc(kb.content)}', 'text',
            ${kb.priority}, '${esc(kb.category)}', 1
     WHERE NOT EXISTS (
       SELECT 1 FROM knowledge_sources WHERE tenant_id='tenant_default'
         AND title = '${esc(kb.title)}'
     );`
  );
}

console.log(`\nSQL statements: ${sqlLines.length}`);

// Write in batches (D1 has limits per execute)
const BATCH = 50;
let totalInserted = 0;
for (let i = 0; i < sqlLines.length; i += BATCH) {
  const batch = sqlLines.slice(i, i + BATCH).join('\n');
  writeFileSync(TMP_SQL, batch);
  try {
    execSync(
      `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP_SQL}`,
      { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 },
    );
    totalInserted += Math.min(BATCH, sqlLines.length - i);
    process.stdout.write(`\r  batch ${Math.floor(i/BATCH)+1}/${Math.ceil(sqlLines.length/BATCH)}`);
  } catch (e) {
    console.error(`\nBatch ${Math.floor(i/BATCH)+1} failed:`, e.message?.slice(0, 200));
  }
}
try { unlinkSync(TMP_SQL); } catch (_) {}

console.log(`\n\nDone. Processed ${totalInserted} SQL statements.`);

// Verify counts
const afterRaw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT (SELECT COUNT(*) FROM faq WHERE is_active=1) as faq_count, (SELECT COUNT(*) FROM knowledge_sources WHERE is_active=1) as kb_count"`,
  { stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 },
).toString();
const after = JSON.parse(afterRaw)[0]?.results?.[0] || {};
console.log(`Final counts — FAQ: ${after.faq_count}, Knowledge: ${after.kb_count}`);
