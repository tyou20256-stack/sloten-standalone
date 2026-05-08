// Heavy QA: run each of 20 cases 5 times for empty-response detection
// after Fix A+B+C. Total 100 runs.
import { writeFileSync } from 'node:fs';

const BASE = 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';
const RUNS_PER_CASE = 5;
const OUT = 'C:\\tmp\\ai-qa-100.json';

const CASES = [
  { id: 'deposit-1', cat: '入金方法',  query: 'paypay入金方法' },
  { id: 'deposit-2', cat: '入金方法',  query: '銀行振込のやり方を教えて' },
  { id: 'deposit-3', cat: '入金方法',  query: 'ATM入金手順' },
  { id: 'withdraw-1', cat: '出金',     query: '出金方法を教えて' },
  { id: 'withdraw-2', cat: '出金',     query: '出金にどれくらい時間かかる' },
  { id: 'account-1', cat: 'アカウント', query: '登録方法を教えてください' },
  { id: 'account-2', cat: 'アカウント', query: 'KYCは必要ですか' },
  { id: 'bonus-1',   cat: 'ボーナス',   query: 'ボーナスコードの使い方は？' },
  { id: 'bonus-2',   cat: 'ボーナス',   query: '入金不要ボーナスはありますか' },
  { id: 'site-1',    cat: 'サイト',     query: 'ライセンスはどこですか' },
  { id: 'site-2',    cat: 'サイト',     query: 'カスタマーサポートの営業時間' },
  { id: 'machine-1', cat: '機種',       query: 'スマスロで継続率80%以上の機種' },
  { id: 'machine-2', cat: '機種',       query: '天井1300Gくらいの機種' },
  { id: 'execute-1', cat: '実行依頼',   query: '入金したいです' },
  { id: 'execute-2', cat: '実行依頼',   query: 'オペレーターと話したい' },
  { id: 'edge-1',    cat: '不明入力',   query: 'foobar123xyzqq' },
  { id: 'edge-2',    cat: '英語',       query: 'How do I deposit money?' },
  { id: 'edge-3',    cat: '苦情',       query: 'ふざけるな！金返せ' },
  { id: 'edge-4',    cat: '短文',       query: 'うん' },
  { id: 'edge-5',    cat: '雑談',       query: 'こんにちは、いいスロットありますか' },
];

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Sloten-Contact-Token'] = token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = { raw: txt }; }
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${d.error || txt.slice(0, 200)}`);
  return d;
}
async function setup() {
  const c = await api('POST', '/api/widget/contacts', { tenant_id: 'tenant_default' });
  const conv = await api('POST', '/api/widget/conversations', { contact_id: c.contact.id, tenant_id: 'tenant_default' }, c.contact_token);
  return { token: c.contact_token, convId: conv.conversation.id };
}
async function send(convId, token, text) {
  return api('POST', `/api/widget/conversations/${convId}/messages`, { sender_type: 'customer', content: text }, token);
}
async function navigate(convId, token) {
  await send(convId, token, 'こんにちは');
  await new Promise(r => setTimeout(r, 200));
  await send(convId, token, 'deposit_withdrawal');
  await new Promise(r => setTimeout(r, 200));
  await send(convId, token, 'deposit_methods');
  await new Promise(r => setTimeout(r, 200));
  await send(convId, token, 'bank_transfer');
  await new Promise(r => setTimeout(r, 600));
}

async function runOne(testCase, run) {
  const t0 = Date.now();
  try {
    const { convId, token } = await setup();
    await navigate(convId, token);
    const resp = await send(convId, token, testCase.query);
    const replies = resp.bot_replies || (resp.bot_reply ? [resp.bot_reply] : []);
    const text = replies.map(r => r?.content || '').filter(Boolean).join('\n');
    return {
      id: testCase.id,
      run,
      cat: testCase.cat,
      query: testCase.query,
      reply_len: text.length,
      reply: text.slice(0, 800),
      n_replies: replies.length,
      latency_ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      id: testCase.id, run, cat: testCase.cat, query: testCase.query,
      reply_len: 0, reply: '', n_replies: 0, error: e.message,
      latency_ms: Date.now() - t0,
    };
  }
}

async function main() {
  const results = [];
  for (const tc of CASES) {
    for (let i = 1; i <= RUNS_PER_CASE; i++) {
      process.stdout.write(`[${tc.id}/${i}] ${tc.query.slice(0,20)}... `);
      const r = await runOne(tc, i);
      results.push(r);
      console.log(`len=${r.reply_len} (${r.latency_ms}ms)${r.error?' ERR:'+r.error:''}`);
      await new Promise(rs => setTimeout(rs, 1200));
    }
  }
  writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf-8');
  // Summary
  const total = results.length;
  const empties = results.filter(r => r.reply_len < 5);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total: ${total} runs`);
  console.log(`Empty replies (<5 chars): ${empties.length}`);
  if (empties.length) {
    console.log('Empty cases:');
    for (const e of empties) console.log(`  - [${e.id}/${e.run}] ${e.query} ${e.error?'(err: '+e.error+')':''}`);
  }
  // By case
  const byCase = {};
  for (const r of results) {
    byCase[r.id] ??= { runs: 0, empty: 0, query: r.query };
    byCase[r.id].runs++;
    if (r.reply_len < 5) byCase[r.id].empty++;
  }
  for (const [id, s] of Object.entries(byCase)) {
    if (s.empty > 0) console.log(`  [${id}] empty ${s.empty}/${s.runs}`);
  }
  console.log(`\nWrote ${OUT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
