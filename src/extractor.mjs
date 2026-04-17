// Shared extractor used by scheduled.mjs (weekly) and by faq-candidates.mjs
// (manual trigger). Scans recent customer/staff messages, pairs them, filters
// deposit-related pairs, clusters by normalized question prefix, and upserts
// into faq_candidates (status=pending).

// Reject pairs that touch money movement, payment instruments, or bonus-code
// handling — all handled by deposit flows / GAS today, so extracting them as
// FAQs pollutes the knowledge base.
const DEPOSIT_KEYWORDS = [
  '入金','出金','振込','送金','入出金','支払','支払い','決済','着金',
  'PayPay','ペイペイ','LinePay','ライン','銀行振込','銀行',
  'Amazon','アマゾン','amazonギフト','ギフト券','ビットコイン','仮想通貨',
  '振り込','返金','チャージ','反映','ボーナスコード',
];
const DEPOSIT_RE = new RegExp('(?:' + DEPOSIT_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');

// Reject anything that looks like a transaction receipt / account identifier
// even when deposit keywords aren't present. Covers PayPay 20-digit txn IDs,
// long account numbers, alphanumeric game IDs (syt2525m etc.), upload talk.
const TRANSACTIONAL_RE = new RegExp([
  '取引番号', '取引ID', '注文番号', '決済番号', '申請番号', '受付番号',
  'アカウントID', 'ユーザーID', 'ユーザー名', 'ID入力', 'ID教え', 'ログインID',
  'スクリーンショット', 'スクショ', '画像添付', '添付画像', 'キャプチャ',
  '完了画面', '決済画面',
].join('|'), 'i');
// Any digit run 15+ chars (PayPay txn IDs are 20).
const LONG_DIGIT_RE = /\b\d{15,}\b/;
// Game-account-style tokens: 3-20 chars, alphanum with optional _/-, must
// contain at least one letter AND at least one digit (so a bare number like
// "5000" or a dictionary word like "mpompo" doesn't false-match).
const ACCOUNT_ID_RE = /\b(?=[A-Za-z0-9_-]{3,20}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/;
// Amount mentions: "5000円", "¥3,000", "¥1500" — leak monetary info even
// when not deposit-keyword tagged. Used by the purge script and extractor.
const AMOUNT_RE = /(?:¥\s?\d{1,3}(?:,?\d{3})*|\d{1,3}(?:,\d{3})+\s*円|\d{3,}\s*円)/;

function maskPII(s) {
  if (!s) return '';
  return String(s)
    .replace(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/0[789]0[-\s]?\d{4}[-\s]?\d{4}/g, '[PHONE]')
    // Any digit run 12+ chars is sensitive (txn IDs, account numbers, etc.).
    .replace(/\b\d{12,}\b/g, '[ACCT]')
    .replace(/¥\s?\d{1,3}(?:,?\d{3})*/g, '¥[AMT]')
    .replace(/\d{1,3}(?:,\d{3})+\s*円/g, '[AMT]円');
}

// Combined rejection predicate (used by the extractor loop AND by the purge
// script that cleans stale pending candidates).
// Answers that are bot canned responses — not real staff answers.
const BOT_ANSWER_RE = /ご希望の項目をお選びください|スロット天国カスタマーサポートへようこそ|このメッセージは削除されました|オペレーターにお繋ぎします。\n\n順番に/;
// Customer messages that are just status-checking / pleasantries / noise.
const NOISE_QUESTION_RE = /^(ありがとう|よろしく|おはよう|こんにちは|こんばんは|すみません|はい|了解|わかりました|お願いします|承知しました|かしこまりました|分かりました|確認しました|完了しました|いけました|出来ました|宜しく|OK|検討します|まだですか|どうなりましたか|どうなってますか|いかがですか|いかがでしょうか|まだかかりますか|確認お願いします|ご対応お願い|お願い致します|気をつけます)/i;
// Short fragments or single words that lack context.
const TOO_SHORT_RE = /^.{0,5}$/;

export function shouldRejectFaqPair(question, answer) {
  const q = (question || '').trim();
  const a = (answer || '').trim();
  const joined = `${q}\n${a}`;
  if (DEPOSIT_RE.test(joined)) return 'deposit';
  if (TRANSACTIONAL_RE.test(joined)) return 'transactional';
  if (LONG_DIGIT_RE.test(joined)) return 'long_digit';
  if (ACCOUNT_ID_RE.test(joined)) return 'account_id';
  if (AMOUNT_RE.test(joined)) return 'amount';
  if (BOT_ANSWER_RE.test(a)) return 'bot_answer';
  if (NOISE_QUESTION_RE.test(q)) return 'noise_question';
  if (TOO_SHORT_RE.test(q)) return 'too_short';
  return null;
}
function normalize(s) {
  return String(s).replace(/\s+/g, ' ').replace(/[!！?？。、「」『』()（）\[\]【】,.…]/g, '').trim();
}
function clusterKey(q) { return normalize(q).slice(0, 24); }
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

// Run against the caller's D1 binding. `sinceIso` (optional) restricts to
// messages newer than the given timestamp; omit for a full scan.
export async function extractFaqCandidates(env, { sinceIso = null, chunkSize = 2000, maxChunks = 40 } = {}) {
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';

  let lastTs = sinceIso || '1970-01-01 00:00:00';
  const byConv = new Map();
  let totalFetched = 0;

  // Build base query with parameterized placeholders (no template-literal
  // SQL interpolation — fixes the CRITICAL SQL-injection finding from the
  // audit). `sinceIso` was previously string-interpolated into the WHERE
  // clause; now it feeds into `lastTs` which is always bound via `?`.
  const baseSql = sinceIso
    ? `SELECT id, conversation_id, sender_type, content, created_at
         FROM messages
        WHERE tenant_id = ?
          AND is_private = 0
          AND sender_type IN ('customer','staff')
          AND created_at >= ?
          AND created_at > ?
     ORDER BY created_at ASC LIMIT ?`
    : `SELECT id, conversation_id, sender_type, content, created_at
         FROM messages
        WHERE tenant_id = ?
          AND is_private = 0
          AND sender_type IN ('customer','staff')
          AND created_at > ?
     ORDER BY created_at ASC LIMIT ?`;

  for (let i = 0; i < maxChunks; i++) {
    const stmt = sinceIso
      ? env.DB.prepare(baseSql).bind(tenantId, sinceIso, lastTs, chunkSize)
      : env.DB.prepare(baseSql).bind(tenantId, lastTs, chunkSize);
    const { results } = await stmt.all();
    if (!results || results.length === 0) break;
    for (const m of results) {
      let arr = byConv.get(m.conversation_id);
      if (!arr) { arr = []; byConv.set(m.conversation_id, arr); }
      arr.push(m);
    }
    lastTs = results[results.length - 1].created_at;
    totalFetched += results.length;
    if (results.length < chunkSize) break;
  }

  const clusters = new Map();
  let depositFiltered = 0, pairs = 0;
  for (const [, msgs] of byConv) {
    for (let i = 0; i < msgs.length; i++) {
      const c = msgs[i];
      if (c.sender_type !== 'customer') continue;
      const cc = c.content || '';
      if (cc.length < 5 || cc.length > 300) continue;
      let staffIdx = -1;
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].sender_type === 'staff' && (msgs[j].content || '').length >= 5) { staffIdx = j; break; }
      }
      if (staffIdx < 0) continue;
      pairs++;
      const q = maskPII(cc);
      const a = maskPII(msgs[staffIdx].content);
      if (q.length < 5 || a.length < 5) continue;
      const reject = shouldRejectFaqPair(q, a);
      if (reject) { depositFiltered++; continue; }
      const key = clusterKey(q);
      if (!key) continue;
      const prev = clusters.get(key);
      if (prev) {
        prev.count++;
        if (a.length > prev.answer.length) prev.answer = a;
      } else {
        clusters.set(key, { cluster_key: key, question: q, answer: a, count: 1, category: categorize(q) });
      }
    }
  }

  // Upsert into faq_candidates. Only pending candidates can be auto-updated;
  // approved or rejected ones are not changed.
  let inserted = 0, updated = 0;
  for (const c of clusters.values()) {
    const existing = await env.DB.prepare(
      `SELECT id, status, source_count, answer FROM faq_candidates WHERE tenant_id = ? AND cluster_key = ?`
    ).bind(tenantId, c.cluster_key).first();
    if (existing) {
      if (existing.status !== 'pending') continue;
      const newCount = (existing.source_count || 0) + c.count;
      // Keep longer answer of the two
      const answer = (c.answer.length > (existing.answer?.length || 0)) ? c.answer.slice(0, 2000) : existing.answer;
      await env.DB.prepare(
        `UPDATE faq_candidates SET source_count = ?, answer = ?, last_seen_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(newCount, answer, existing.id).run();
      updated++;
    } else {
      await env.DB.prepare(
        `INSERT INTO faq_candidates (tenant_id, cluster_key, question, answer, category, source_count, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(tenantId, c.cluster_key, c.question.slice(0, 500), c.answer.slice(0, 2000), c.category, c.count).run();
      inserted++;
    }
  }

  return {
    scanned_messages: totalFetched,
    pairs_assembled: pairs,
    deposit_filtered: depositFiltered,
    unique_clusters: clusters.size,
    inserted, updated,
    since: sinceIso,
  };
}

export async function getLastExtractionTs(env) {
  const row = await env.DB.prepare(`SELECT value FROM feature_flags WHERE key = 'faq_extract_last_run_ts'`).first();
  return row?.value ? parseInt(row.value, 10) : 0;
}
export async function setLastExtractionTs(env, ts) {
  await env.DB.prepare(
    `INSERT INTO feature_flags (key, value, updated_at) VALUES ('faq_extract_last_run_ts', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(String(ts)).run();
}
