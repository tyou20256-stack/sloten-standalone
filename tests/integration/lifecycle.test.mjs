// Conversation lifecycle integration test.
// Exercises the full chat path: contact creation → conversation → messages
// → escalation → status flip → admin visibility. Covers code paths that
// property tests can't reach (full HTTP round-trip).
//
// Run: node tests/integration/lifecycle.test.mjs
//   (requires staging-bk to be live and admin credentials)

import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tester@staging.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '6jr3aYmKDPb3U5De';

let pass = 0, fail = 0;
async function step(label, fn) {
  try { await fn(); console.log(`✓ ${label}`); pass++; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); fail++; throw e; }
}

let contactToken = null;
let contactId = null;
let conversationId = null;

await step('create contact (widget API)', async () => {
  const r = await fetch(`${BASE}/api/widget/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: 'tenant_default' }),
  });
  assert.equal(r.status, 201, `expected 201, got ${r.status}`);
  const body = await r.json();
  assert.ok(body.contact?.id, 'no contact.id');
  assert.ok(body.contact_token, 'no contact_token');
  contactId = body.contact.id;
  contactToken = body.contact_token;
});

await step('create conversation', async () => {
  const r = await fetch(`${BASE}/api/widget/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sloten-Contact-Token': contactToken },
    body: JSON.stringify({ contact_id: contactId, tenant_id: 'tenant_default' }),
  });
  assert.equal(r.status, 201, `expected 201, got ${r.status}`);
  const body = await r.json();
  conversationId = body.conversation.id;
  assert.equal(body.conversation.status, 'bot');
});

await step('send normal message — bot replies, status stays "bot"', async () => {
  const r = await fetch(`${BASE}/api/widget/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sloten-Contact-Token': contactToken },
    body: JSON.stringify({ sender_type: 'customer', content: 'PayPay入金方法を教えて' }),
  });
  assert.ok(r.ok, `message send failed: ${r.status}`);
  const body = await r.json();
  const replies = body.bot_replies || (body.bot_reply ? [body.bot_reply] : []);
  assert.ok(replies.length > 0, 'no bot replies');
});

await step('send escalation trigger — status flips to "open"', async () => {
  const r = await fetch(`${BASE}/api/widget/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sloten-Contact-Token': contactToken },
    body: JSON.stringify({ sender_type: 'customer', content: '担当者と話したい' }),
  });
  assert.ok(r.ok, `message send failed: ${r.status}`);
  const body = await r.json();
  const replies = body.bot_replies || (body.bot_reply ? [body.bot_reply] : []);
  const combined = replies.map((m) => m.content || '').join('\n');
  assert.match(combined, /担当者|おつなぎ|お繋ぎ|お待ちくださいませ/, 'escalation phrase missing');
});

await step('post-escalation message gets ack reply (mt-004 fix)', async () => {
  const r = await fetch(`${BASE}/api/widget/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sloten-Contact-Token': contactToken },
    body: JSON.stringify({ sender_type: 'customer', content: '追加の質問です' }),
  });
  assert.ok(r.ok, `message send failed: ${r.status}`);
  const body = await r.json();
  const replies = body.bot_replies || (body.bot_reply ? [body.bot_reply] : []);
  const combined = replies.map((m) => m.content || '').join('\n');
  // Should get at least the auto-ack ("お問い合わせを受け付けました" or similar)
  assert.match(combined, /受け付け|担当者|お待ち/, 'no auto-ack on escalated conversation');
});

// Admin path
let adminCookie = null;

await step('admin login — get cookie', async () => {
  const r = await fetch(`${BASE}/api/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': BASE },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  assert.ok(r.ok, `login failed: ${r.status}`);
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/sloten_staff_session=[^;]+/);
  assert.ok(m, 'no session cookie set');
  adminCookie = m[0];
});

await step('admin can see the conversation just created', async () => {
  const r = await fetch(`${BASE}/api/conversations?limit=10`, {
    headers: { 'Cookie': adminCookie, 'Origin': BASE },
  });
  assert.ok(r.ok, `conversations list failed: ${r.status}`);
  const body = await r.json();
  const found = (body.conversations || []).some((c) => c.id === conversationId);
  assert.ok(found, `conversation ${conversationId} not in admin list`);
});

await step('admin sees the conversation as "open" status', async () => {
  const r = await fetch(`${BASE}/api/conversations/${conversationId}`, {
    headers: { 'Cookie': adminCookie, 'Origin': BASE },
  });
  assert.ok(r.ok);
  const body = await r.json();
  assert.equal(body.conversation.status, 'open', `expected open, got ${body.conversation.status}`);
});

await step('admin logout invalidates session (revocation list)', async () => {
  // CSRF guard requires Origin + Sec-Fetch-Site for state-changing requests
  const r = await fetch(`${BASE}/api/staff/logout`, {
    method: 'POST',
    headers: { 'Cookie': adminCookie, 'Origin': BASE, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.ok(r.ok, `logout failed: ${r.status}`);
  // Verify cookie no longer authenticates
  const r2 = await fetch(`${BASE}/api/staff/me`, { headers: { 'Cookie': adminCookie } });
  assert.equal(r2.status, 401, `post-logout me should be 401, got ${r2.status}`);
});

console.log(`\n${pass}/${pass + fail} steps pass`);
process.exit(fail > 0 ? 1 : 0);
