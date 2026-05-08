// Verify the 天井800G fix — should no longer mix in NOLIMITCITY/FAQ 259
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

const TESTS = [
  // Filter-failed cases — should now refuse politely, not mix FAQ
  { id: 'ceiling-800', query: '天井が800Gぐらいのスロットは？', forbid: ['NOLIMITCITY', 'BUY'] },
  { id: 'ceiling-1300', query: '天井1300Gくらいの機種', forbid: ['NOLIMITCITY', 'BUY'] },
  { id: 'fun-slot', query: '面白いスマスロありますか', forbid: ['NOLIMITCITY', 'BUY'] },
  // Filter-passing cases — should still work
  { id: 'continuation-80', query: 'スマスロで継続率80%以上の機種', forbid: ['NOLIMITCITY', 'BUY'], must: ['継続率'] },
  // Specific machine name — should still work via name_keywords
  { id: 'specific-name', query: 'バイオハザードヴィレッジについて', forbid: [] },
];

async function main() {
  const out = [];
  for (const t of TESTS) {
    for (let run = 1; run <= 2; run++) {
      const { convId, token } = await setup();
      await navigate(convId, token);
      const r = await send(convId, token, t.query);
      const replies = r.bot_replies || (r.bot_reply ? [r.bot_reply] : []);
      const text = replies.map(x => x?.content || '').join('\n');
      const issues = [];
      for (const w of t.forbid || []) if (text.includes(w)) issues.push(`FORBID:${w}`);
      for (const w of t.must || []) if (!text.includes(w)) issues.push(`MISSING:${w}`);
      out.push({ id: t.id, run, query: t.query, len: text.length, reply: text.slice(0, 600), issues });
      const status = issues.length === 0 ? '✅' : '❌';
      console.log(`${status} [${t.id}/${run}] ${t.query.slice(0,30)} (len=${text.length}) ${issues.join(', ')}`);
      console.log(`     "${text.slice(0,140).replace(/\n/g,' ')}"`);
      await new Promise(rs => setTimeout(rs, 1500));
    }
  }
  const fs = await import('node:fs');
  fs.writeFileSync('C:\\tmp\\ceiling-fix-results.json', JSON.stringify(out, null, 2));
  const fails = out.filter(r => r.issues.length).length;
  console.log(`\n${out.length - fails}/${out.length} pass`);
}
main().catch(e => { console.error(e); process.exit(1); });
