// AI QA test harness — drives the widget API to test AI responses across
// many user scenarios. For each test case it creates a fresh contact +
// conversation, navigates to the bank_transfer fallback step (which is the
// "AI standby" state after our recent change), then sends the test query
// and captures the AI bot reply.
//
// Output: writes /c/tmp/ai-qa-results.json with per-case rows.
//
// Usage: node scripts/ai-qa-test.mjs

const BASE = 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';
const OUT = 'C:\\tmp\\ai-qa-results.json';

const CASES = [
  // ─── 入金方法 (情報質問) ────────────────────────────────────────────
  { id: 'deposit-1', cat: '入金方法',  query: 'paypay入金方法',         must_have: ['手順', 'PayPay'],  forbid: ['ボタンを押']  },
  { id: 'deposit-2', cat: '入金方法',  query: '銀行振込のやり方を教えて',  must_have: ['手順'],            forbid: ['ボタンを押'] },
  { id: 'deposit-3', cat: '入金方法',  query: 'ATM入金手順',            must_have: ['手順', 'ATM'],     forbid: ['ボタンを押'] },
  // ─── 出金 (情報質問) ────────────────────────────────────────────
  { id: 'withdraw-1', cat: '出金',     query: '出金方法を教えて',         must_have: ['出金'],            forbid: ['ボタンを押'] },
  { id: 'withdraw-2', cat: '出金',     query: '出金にどれくらい時間かかる', must_have: ['時間'],            forbid: [] },
  // ─── アカウント ────────────────────────────────────────────
  { id: 'account-1', cat: 'アカウント', query: '登録方法を教えてください',  must_have: [],                  forbid: [] },
  { id: 'account-2', cat: 'アカウント', query: 'KYCは必要ですか',          must_have: ['不要'],            forbid: ['必要です'] },
  // ─── ボーナス ────────────────────────────────────────────
  { id: 'bonus-1',   cat: 'ボーナス',   query: 'ボーナスコードの使い方は？', must_have: [],                  forbid: [] },
  { id: 'bonus-2',   cat: 'ボーナス',   query: '入金不要ボーナスはありますか', must_have: [],               forbid: [] },
  // ─── サイト基本情報 ────────────────────────────────────────────
  { id: 'site-1',    cat: 'サイト',     query: 'ライセンスはどこですか',    must_have: ['ジョージア'],     forbid: ['キュラソー'] },
  { id: 'site-2',    cat: 'サイト',     query: 'カスタマーサポートの営業時間', must_have: ['24'],          forbid: [] },
  // ─── 機種 (pachi-RAG) ────────────────────────────────────────────
  { id: 'machine-1', cat: '機種',       query: 'スマスロで継続率80%以上の機種', must_have: ['継続率'],     forbid: [] },
  { id: 'machine-2', cat: '機種',       query: '天井1300Gくらいの機種',     must_have: [],                forbid: [] },
  // ─── 実行依頼 (deflection が正しい) ────────────────────────────────────────────
  { id: 'execute-1', cat: '実行依頼',   query: '入金したいです',           must_have: ['メニュー'],        forbid: [] },
  { id: 'execute-2', cat: '実行依頼',   query: 'オペレーターと話したい',    must_have: ['担当者'],          forbid: [] /* should escalate */ },
  // ─── 不適切/不明 ────────────────────────────────────────────
  { id: 'edge-1',    cat: '不明入力',   query: 'foobar123xyzqq',          must_have: [],                  forbid: [] },
  { id: 'edge-2',    cat: '英語',       query: 'How do I deposit money?',  must_have: ['日本語'],          forbid: [] },
  // ─── エッジ ────────────────────────────────────────────
  { id: 'edge-3',    cat: '苦情',       query: 'ふざけるな！金返せ',       must_have: [],                  forbid: [] /* may escalate */ },
  { id: 'edge-4',    cat: '短文',       query: 'うん',                    must_have: [],                  forbid: [] },
  { id: 'edge-5',    cat: '雑談',       query: 'こんにちは、いいスロットありますか', must_have: [],         forbid: [] },
];

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Sloten-Contact-Token'] = token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${data.error || text.slice(0, 200)}`);
  return data;
}

async function setupConversation() {
  // 1. Create contact
  const c = await api('POST', '/api/widget/contacts', { tenant_id: 'tenant_default' });
  const contactId = c.contact.id;
  const token = c.contact_token;
  // 2. Create conversation
  const conv = await api('POST', '/api/widget/conversations', { contact_id: contactId, tenant_id: 'tenant_default' }, token);
  const convId = conv.conversation.id;
  return { contactId, token, convId };
}

async function send(convId, token, text) {
  return api('POST', `/api/widget/conversations/${convId}/messages`, { sender_type: 'customer', content: text }, token);
}

async function navigateToAiStandby(convId, token) {
  // Send empty/initial message to trigger welcome flow (any non-trigger text works)
  // Then navigate: welcome → deposit_withdrawal → deposit_methods → bank_transfer
  await send(convId, token, 'こんにちは');             // start welcome
  await new Promise(r => setTimeout(r, 200));
  await send(convId, token, 'deposit_withdrawal');     // 💰 入金・出金
  await new Promise(r => setTimeout(r, 200));
  await send(convId, token, 'deposit_methods');        // 🏦 ご入金について
  await new Promise(r => setTimeout(r, 200));
  await send(convId, token, 'bank_transfer');          // 🏦 銀行振込 → webhook fail → AI standby
  await new Promise(r => setTimeout(r, 600));
}

function extractBotText(resp) {
  const replies = resp.bot_replies || (resp.bot_reply ? [resp.bot_reply] : []);
  return replies.map(r => r?.content || '').filter(Boolean).join('\n---\n');
}

function score(text, must_have, forbid) {
  const issues = [];
  for (const word of must_have) {
    if (!text.includes(word)) issues.push(`MISSING: "${word}"`);
  }
  for (const word of forbid) {
    if (text.includes(word)) issues.push(`FORBID HIT: "${word}"`);
  }
  if (!text || text.length < 10) issues.push('TOO_SHORT');
  if (text.includes('FAQやナレッジに該当する情報が見当たりませんでした')) issues.push('AI gave up (no info)');
  if (/Error|HTTP \d{3}|undefined/i.test(text)) issues.push('error in reply');
  return { pass: issues.length === 0, issues };
}

async function runOne(testCase) {
  const t0 = Date.now();
  try {
    const { convId, token } = await setupConversation();
    await navigateToAiStandby(convId, token);
    const resp = await send(convId, token, testCase.query);
    const text = extractBotText(resp);
    const verdict = score(text, testCase.must_have, testCase.forbid);
    return {
      id: testCase.id,
      cat: testCase.cat,
      query: testCase.query,
      reply: text,
      pass: verdict.pass,
      issues: verdict.issues,
      latency_ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      id: testCase.id,
      cat: testCase.cat,
      query: testCase.query,
      reply: '',
      pass: false,
      issues: ['EXCEPTION: ' + e.message],
      latency_ms: Date.now() - t0,
    };
  }
}

async function main() {
  const results = [];
  for (const tc of CASES) {
    process.stdout.write(`[${tc.id}] ${tc.cat} | ${tc.query.slice(0, 30)} ... `);
    const r = await runOne(tc);
    results.push(r);
    console.log(r.pass ? `PASS (${r.latency_ms}ms)` : `FAIL: ${r.issues.join(', ')}`);
    await new Promise(rs => setTimeout(rs, 1500)); // rate-limit cooldown
  }
  const fs = await import('node:fs');
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf-8');
  console.log('\nWrote', OUT);
  // summary
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log(`\nSummary: ${passed}/${total} pass (${Math.round(passed * 100 / total)}%)`);
  const byCat = {};
  for (const r of results) {
    byCat[r.cat] ??= { pass: 0, fail: 0 };
    if (r.pass) byCat[r.cat].pass++;
    else byCat[r.cat].fail++;
  }
  for (const [cat, s] of Object.entries(byCat)) {
    console.log(`  ${cat}: ${s.pass} pass / ${s.fail} fail`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
