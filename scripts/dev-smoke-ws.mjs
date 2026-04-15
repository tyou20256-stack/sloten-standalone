#!/usr/bin/env node
// WebSocket smoke test.
// Flow:
//   1. Create contact + conversation via REST
//   2. Open WS /ws/widget/conversations/:id
//   3. Expect hello.ack
//   4. POST customer message via REST (triggers bot reply + broadcast)
//   5. Expect message.created frame(s) on the WS
//
// Usage:
//   node scripts/dev-smoke-ws.mjs [BASE_URL]
// Example:
//   node scripts/dev-smoke-ws.mjs http://127.0.0.1:8787

// Node 22+ exposes WebSocket globally; fall back to undici if not.
const WS = globalThis.WebSocket || (await import('undici')).WebSocket;

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; }
  catch { return { status: r.status, data: { raw: t } }; }
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  OK:', msg);
}

function waitFrame(ws, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error(`timeout waiting for frame (${timeoutMs}ms)`));
    }, timeoutMs);
    function onMsg(ev) {
      let f;
      try { f = JSON.parse(ev.data); } catch { return; }
      if (predicate(f)) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolve(f);
      }
    }
    ws.addEventListener('message', onMsg);
  });
}

async function main() {
  console.log(`WS smoke test against ${BASE}`);

  const c = await j('POST', '/api/widget/contacts', { name: 'WS Test' });
  assert(c.status === 201, 'contact created');
  const contactId = c.data.contact.id;

  const cv = await j('POST', '/api/widget/conversations', { contact_id: contactId });
  assert(cv.status === 201, 'conversation created');
  const convId = cv.data.conversation.id;

  const ws = new WS(`${WS_BASE}/ws/widget/conversations/${convId}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message || e}`)), { once: true });
    setTimeout(() => reject(new Error('ws open timeout')), 5000);
  });
  console.log('  OK: ws open');

  const hello = await waitFrame(ws, (f) => f.type === 'hello.ack', 3000);
  assert(hello.conversation_id === convId, 'hello.ack conversation_id matches');

  // Fire a customer message via REST — should broadcast back over WS.
  const waitMsg = waitFrame(ws, (f) => f.type === 'message.created' && f.message?.sender_type === 'customer', 5000);
  const postRes = await j('POST', `/api/widget/conversations/${convId}/messages`, {
    sender_type: 'customer',
    content: 'テスト',
  });
  assert(postRes.status === 201, 'REST POST message accepted');
  const frame = await waitMsg;
  assert(frame.message.content === 'テスト', 'WS received customer message.created');

  // Wait briefly for bot reply broadcast (if AI is configured)
  try {
    const bot = await waitFrame(ws, (f) => f.type === 'message.created' && f.message?.sender_type === 'bot', 6000);
    console.log('  OK: WS received bot.message.created:', (bot.message.content || '').slice(0, 80));
  } catch (_) {
    console.log('  SKIP: no bot reply frame within 6s (AI may be unconfigured — expected in empty-DB env)');
  }

  ws.close();
  console.log('\nWS smoke test PASSED.');
}

main().catch((e) => { console.error(e); process.exit(1); });
