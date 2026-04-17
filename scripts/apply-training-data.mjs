#!/usr/bin/env node
// Apply extracted training data via admin API (avoids SQL escaping issues).
// Reads the extraction result from extract-training-data and POSTs to the API.

import { execSync } from 'node:child_process';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const BASE = 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';
const TOKEN = 'adm_test_1776343878_xyz';
const H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` };

// ---- Same extraction logic (inlined) ----
const DEPOSIT_RE = /入金|出金|振込|送金|入出金|支払|支払い|決済|着金|PayPay|ペイペイ|LinePay|ライン|銀行振込|銀行|Amazon|アマゾン|ギフト券|ビットコイン|仮想通貨|振り込|返金|チャージ|反映|ボーナスコード/i;
const TRANSACTIONAL_RE = /取引番号|取引ID|注文番号|決済番号|申請番号|受付番号|アカウントID|ユーザーID|ユーザー名|ID入力|スクリーンショット|スクショ|画像添付|完了画面|決済画面/i;
const LONG_DIGIT_RE = /\b\d{15,}\b/;
const ACCOUNT_ID_RE = /\b(?=[A-Za-z0-9_-]{3,20}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/;
const AMOUNT_RE = /(?:¥\s?\d{1,3}(?:,?\d{3})*|\d{1,3}(?:,\d{3})+\s*円|\d{3,}\s*円)/;
const BONUS_CODE_RE = /スペシャルステップ|バモスイボナ|あけおめ|スペシャルチャンス|特別ステップ|特別ヘブンズ|カスタムヘブンズ|トライアスロン|ひな祭り|ヘブンズミッション|ヘブンズウィン|ELITE参加|ホワイトデー|ゾロ目チャレンジ|スロ天ドリーム|ゲートリアン|リリシア|ルシフィーレ|ハルピナ|アークエル|ラフィエル|セレフィム|SAKURA2026/i;

function shouldReject(q, a) {
  const joined = `${q}\n${a}`;
  if (DEPOSIT_RE.test(joined)) return true;
  if (TRANSACTIONAL_RE.test(joined)) return true;
  if (LONG_DIGIT_RE.test(joined)) return true;
  if (ACCOUNT_ID_RE.test(joined)) return true;
  if (AMOUNT_RE.test(joined)) return true;
  if (BONUS_CODE_RE.test(joined)) return true;
  if (/^(メニュー|welcome_message|deposit_withdrawal|deposit_methods|game_info|bonus_promo|faq_main|account_issues|transfer_to_agent)$/i.test(q.trim())) return true;
  if (/^(ありがとう|よろしく|おはよう|こんにちは|こんばんは|すみません|はい$|了解|わかりました|お願いします$|OK$)/i.test(q.trim())) return true;
  if (/^\[PHONE\]|^\[EMAIL\]|^\[ID\]|^\d{6,}$/.test(q.trim())) return true;
  if (/スロット天国カスタマーサポートへようこそ|オペレーターにお繋ぎします|ご希望の項目を下記メニュー/.test(a)) return true;
  if (a.length < 20) return true;
  return false;
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
  if (/アカウント|登録|ログイン|パスワード|メール|電話番号|認証/i.test(q)) return 'アカウント';
  if (/ボーナス|キャンペーン|特典|プロモ|フリースピン|FS|賭け条件|ターンオーバー/i.test(q)) return 'ボーナス';
  if (/ゲーム|スロット|プレイ|スピン|ジャックポット|機種|エボリューション/i.test(q)) return 'ゲーム';
  if (/KYC|本人確認|身分証/i.test(q)) return '本人確認';
  if (/VIP|ランク|還元/i.test(q)) return 'VIP';
  if (/退会|解約|停止|凍結/i.test(q)) return 'アカウント';
  if (/サポート|問い合わせ|営業時間/i.test(q)) return 'サポート';
  return '一般';
}

// ---- Fetch + Extract ----
console.log('Fetching messages...');
const pairsRaw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT conversation_id, sender_type, content, created_at FROM messages WHERE is_private=0 AND sender_type IN ('customer','staff') AND content IS NOT NULL AND LENGTH(content) > 3 ORDER BY conversation_id, created_at ASC"`,
  { stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 },
).toString();
const allMsgs = JSON.parse(pairsRaw)[0]?.results || [];
console.log(`Messages: ${allMsgs.length}`);

const byConv = new Map();
for (const m of allMsgs) {
  if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
  byConv.get(m.conversation_id).push(m);
}

const pairs = [];
for (const [, msgs] of byConv) {
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].sender_type !== 'customer') continue;
    const q = (msgs[i].content || '').trim();
    if (q.length < 8 || q.length > 500) continue;
    let staffReply = null;
    for (let j = i + 1; j < msgs.length && j <= i + 5; j++) {
      if (msgs[j].sender_type === 'staff' && (msgs[j].content || '').trim().length >= 10) { staffReply = msgs[j]; break; }
    }
    if (!staffReply) continue;
    const a = (staffReply.content || '').trim();
    if (shouldReject(q, a)) continue;
    pairs.push({ question: maskPII(q), answer: maskPII(a), category: categorize(q) });
  }
}
console.log(`Valid pairs: ${pairs.length}`);

// Cluster
function norm(s) { return s.replace(/[\s!！?？。、「」『』()（）\[\]【】,.…]/g, '').toLowerCase().slice(0, 30); }
const clusters = new Map();
for (const p of pairs) {
  const k = norm(p.question);
  if (!k || k.length < 3) continue;
  if (!clusters.has(k)) clusters.set(k, { ...p, count: 1 });
  else { const c = clusters.get(k); c.count++; if (p.answer.length > c.answer.length) c.answer = p.answer; }
}
const ranked = [...clusters.values()].filter(c => c.answer.length >= 15).sort((a, b) => b.count - a.count || b.answer.length - a.answer.length);
const faqList = [...ranked.filter(c => c.count >= 2).slice(0, 200), ...ranked.filter(c => c.count === 1 && c.answer.length > 80).slice(0, 100)];
console.log(`FAQ candidates: ${faqList.length}`);

// ---- Insert via API ----
let faqInserted = 0;
for (const f of faqList) {
  try {
    const r = await fetch(BASE + '/api/faq', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        tenant_id: 'tenant_default',
        question: f.question,
        answer: f.answer,
        category: f.category,
        priority: f.count >= 3 ? 2 : 1,
        is_active: 1,
      }),
    });
    if (r.ok) faqInserted++;
    else console.warn(`  FAQ skip (${r.status}):`, f.question.slice(0, 30));
  } catch (e) { console.warn(`  FAQ error:`, e.message); }
}
console.log(`FAQ inserted: ${faqInserted}`);

// ---- Knowledge entries ----
const kbByCategory = new Map();
for (const c of ranked.slice(0, 300)) {
  if (!kbByCategory.has(c.category)) kbByCategory.set(c.category, []);
  kbByCategory.get(c.category).push(c);
}
let kbInserted = 0;
for (const [cat, items] of kbByCategory) {
  if (items.length < 3) continue;
  const content = items.slice(0, 30).map(it => `Q: ${it.question}\nA: ${it.answer}`).join('\n\n---\n\n');
  try {
    const r = await fetch(BASE + '/api/knowledge-sources', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        title: `${cat} — 会話履歴Q&A集 (${items.length}件)`,
        content: content.slice(0, 8000),
        source_type: 'text',
        priority: items.length >= 10 ? 4 : 3,
        category: 'general',
        is_active: 1,
      }),
    });
    if (r.ok) kbInserted++;
  } catch (e) { console.warn(`  KB error:`, e.message); }
}
console.log(`Knowledge inserted: ${kbInserted}`);
console.log('\nDone.');
