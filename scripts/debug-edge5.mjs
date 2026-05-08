// Debug edge-5 failure: send "こんにちは、いいスロットありますか" multiple times
// after entering AI standby, to characterize the empty-response behavior.
const BASE = 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Sloten-Contact-Token'] = token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = { raw: txt }; }
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${d.error || txt.slice(0,200)}`);
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

const TARGET = 'こんにちは、いいスロットありますか';
const VARIANTS = [
  'こんにちは、いいスロットありますか',
  'いいスロットありますか',
  'おすすめのスロット教えて',
  'こんにちは、おすすめのスマスロありますか',
  'スマスロのおすすめは？',
  'こんにちは',
  'いいスロットを教えてください',
];

const RUNS = 3; // each variant is run 3 times to characterize variability

async function main() {
  const out = [];
  for (const q of VARIANTS) {
    for (let i = 1; i <= RUNS; i++) {
      const { token, convId } = await setup();
      await navigate(convId, token);
      const r = await send(convId, token, q);
      const replies = r.bot_replies || (r.bot_reply ? [r.bot_reply] : []);
      const text = replies.map(x => x?.content || '').join(' ');
      const types = replies.map(x => x?.content_type || '?').join(',');
      const result = {
        query: q,
        run: i,
        reply_len: text.length,
        reply: text,
        content_types: types,
        n_replies: replies.length,
      };
      out.push(result);
      console.log(`[${q.slice(0,15)}... run ${i}] len=${text.length} types=${types} reply="${text.slice(0,80)}"`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  const fs = await import('node:fs');
  fs.writeFileSync('C:\\tmp\\debug-edge5-results.json', JSON.stringify(out, null, 2));
  console.log('\nWrote /c/tmp/debug-edge5-results.json');
  // Summary by query
  const byQ = {};
  for (const r of out) {
    byQ[r.query] ??= { runs: 0, empty: 0, types: new Set() };
    byQ[r.query].runs++;
    if (r.reply_len < 5) byQ[r.query].empty++;
    r.content_types.split(',').forEach(t => byQ[r.query].types.add(t));
  }
  console.log('\nSummary:');
  for (const [q, s] of Object.entries(byQ)) {
    console.log(`  "${q.slice(0,30)}...": empty ${s.empty}/${s.runs}, types=${[...s.types].join(',')}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
