#!/usr/bin/env node
// Smoke test against a running Worker (default: http://127.0.0.1:8787).
// Flow:
//   1. GET /health
//   2. Create contact
//   3. Create conversation
//   4. Send customer message -> expect bot reply inlined
//   5. List messages -> expect 2 rows (customer + bot)
//
// Usage:
//   node scripts/dev-smoke.mjs [BASE_URL]

const BASE = process.argv[2] || 'http://127.0.0.1:8787';

async function j(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: r.status, data };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  OK:', msg);
}

async function main() {
  console.log(`Smoke test against ${BASE}`);

  const health = await j('GET', '/health');
  assert(health.status === 200, `health 200 (got ${health.status})`);

  const c = await j('POST', '/api/widget/contacts', { name: 'Test User' });
  assert(c.status === 201, `contact created (got ${c.status})`);
  const contactId = c.data.contact?.id;
  assert(contactId, 'contact id returned');

  const conv = await j('POST', '/api/widget/conversations', { contact_id: contactId });
  assert(conv.status === 201, `conversation created (got ${conv.status})`);
  const convId = conv.data.conversation?.id;
  assert(convId, 'conversation id returned');
  assert(conv.data.conversation?.status === 'bot', 'initial status=bot');

  const msg = await j('POST', `/api/widget/conversations/${convId}/messages`, {
    sender_type: 'customer',
    content: '入金方法を教えて',
  });
  assert(msg.status === 201, `message sent (got ${msg.status})`);
  console.log('     customer msg id:', msg.data.message?.id);
  console.log('     bot reply:', msg.data.bot_reply?.content?.slice(0, 120) || '(none — AI may be unconfigured)');

  const list = await j('GET', `/api/widget/conversations/${convId}/messages`);
  assert(list.status === 200, `list messages (got ${list.status})`);
  assert((list.data.messages || []).length >= 1, 'at least 1 message in thread');

  console.log('\nSmoke test PASSED.');
}

main().catch((e) => { console.error(e); process.exit(1); });
