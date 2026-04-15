// Shared extractor used by scheduled.mjs (weekly) and by faq-candidates.mjs
// (manual trigger). Scans recent customer/staff messages, pairs them, filters
// deposit-related pairs, clusters by normalized question prefix, and upserts
// into faq_candidates (status=pending).

const DEPOSIT_KEYWORDS = [
  '入金','出金','振込','送金','入出金','支払','支払い','決済','着金',
  'PayPay','ペイペイ','LinePay','ライン','銀行振込','銀行',
  'Amazon','アマゾン','amazonギフト','ギフト券','ビットコイン','仮想通貨',
  '振り込','返金','チャージ','反映','ボーナスコード',
];
const DEPOSIT_RE = new RegExp('(?:' + DEPOSIT_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');

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
  const baseWhere = [
    `tenant_id = '${tenantId}'`,
    `is_private = 0`,
    `sender_type IN ('customer','staff')`,
  ];
  if (sinceIso) baseWhere.push(`created_at >= '${sinceIso.replace(/'/g, "")}'`);

  let lastTs = sinceIso || '1970-01-01 00:00:00';
  const byConv = new Map();
  let totalFetched = 0;

  for (let i = 0; i < maxChunks; i++) {
    const sql = `SELECT id, conversation_id, sender_type, content, created_at
                   FROM messages
                  WHERE ${baseWhere.join(' AND ')}
                    AND created_at > ?
               ORDER BY created_at ASC
                  LIMIT ${chunkSize}`;
    const { results } = await env.DB.prepare(sql).bind(lastTs).all();
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
      if (DEPOSIT_RE.test(q) || DEPOSIT_RE.test(a)) { depositFiltered++; continue; }
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
