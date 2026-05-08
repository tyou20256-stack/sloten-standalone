// Multi-turn fixture runner — extends single-turn Golden Set to verify
// conversational continuity (deadloop detection, clarification flow,
// RG follow-up, mutual exclusion across turns).
//
// Run:
//   node tests/golden-set/run-multi-turn.mjs
//   node tests/golden-set/run-multi-turn.mjs --base-url <staging-url>

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getArg(name, def = null) {
  const idx = process.argv.indexOf(name);
  return idx > -1 ? process.argv[idx + 1] : def;
}
const BASE_URL = getArg('--base-url', 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev');
const TURN_DELAY_MS = parseInt(getArg('--delay', '3000'), 10);

async function createSession() {
  const c = await fetch(`${BASE_URL}/api/widget/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: 'tenant_default' }),
  }).then((r) => r.json());
  const conv = await fetch(`${BASE_URL}/api/widget/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sloten-Contact-Token': c.contact_token },
    body: JSON.stringify({ contact_id: c.contact.id, tenant_id: 'tenant_default' }),
  }).then((r) => r.json());
  return { contactToken: c.contact_token, conversationId: conv.conversation.id };
}

async function sendMessage(token, convId, content) {
  return await fetch(`${BASE_URL}/api/widget/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sloten-Contact-Token': token },
    body: JSON.stringify({ sender_type: 'customer', content }),
  }).then((r) => r.json());
}

function checkTurn(turn, reply) {
  const replies = reply.bot_replies || (reply.bot_reply ? [reply.bot_reply] : []);
  // Combine bot reply text content + input_select option titles. The widget
  // renders both, so test assertions should see both. Without items, asking
  // for "メニュー" → expecting "入金" / "出金" fails because the prompt is
  // just "ご希望の項目をお選びください。" while the actual options live in
  // content_attributes.items as e.g. "💰 入金・出金".
  const combined = replies.map((r) => {
    let s = r.content || '';
    let attrs = r.content_attributes;
    if (typeof attrs === 'string') {
      try { attrs = JSON.parse(attrs); } catch { attrs = null; }
    }
    if (attrs && Array.isArray(attrs.items)) {
      s += '\n' + attrs.items.map((it) => it.title || it.value || '').join(' / ');
    }
    return s;
  }).join('\n');
  const handoff = replies.some((r) =>
    r.content_attributes?.handoff
    || r.content?.includes('担当者')
    || r.content?.includes('おつなぎ')
    || r.content?.includes('お繋ぎ')
    || r.content?.includes('お待ちくださいませ'),
  );
  const issues = [];
  if (turn.expect_phrases?.length) {
    const found = turn.expect_phrases.some((p) => combined.includes(p));
    if (!found) issues.push(`MISSING: [${turn.expect_phrases.join(', ')}]`);
  }
  if (turn.forbidden_phrases?.length) {
    for (const f of turn.forbidden_phrases) {
      if (combined.includes(f)) issues.push(`FORBIDDEN: "${f}"`);
    }
  }
  if (turn.expect_handoff && !handoff) issues.push('Expected handoff');
  return { issues, preview: combined.slice(0, 120), handoff };
}

const fixtures = JSON.parse(await fs.readFile(path.join(__dirname, 'multi-turn.json'), 'utf8'));
console.log(`\nMulti-turn Golden Set against ${BASE_URL}\n${fixtures.length} fixtures\n${'='.repeat(40)}`);

let passed = 0;
let failed = 0;
const allResults = [];

for (const fix of fixtures) {
  console.log(`\n  ${fix.id} [${fix.category}] ${fix.name}`);
  const { contactToken, conversationId } = await createSession();
  const turnResults = [];
  let fixturePass = true;
  for (let i = 0; i < fix.turns.length; i++) {
    const turn = fix.turns[i];
    process.stdout.write(`    turn ${i + 1}: "${turn.input.slice(0, 30)}" ... `);
    try {
      const reply = await sendMessage(contactToken, conversationId, turn.input);
      const r = checkTurn(turn, reply);
      turnResults.push({ turn: i + 1, input: turn.input, ...r });
      if (r.issues.length === 0) {
        console.log('✓');
      } else {
        console.log(`✗ ${r.issues.join('; ')}`);
        fixturePass = false;
      }
    } catch (e) {
      console.log(`✗ ERROR: ${e.message}`);
      turnResults.push({ turn: i + 1, error: e.message });
      fixturePass = false;
    }
    await new Promise((s) => setTimeout(s, TURN_DELAY_MS));
  }
  allResults.push({ id: fix.id, name: fix.name, pass: fixturePass, turns: turnResults });
  if (fixturePass) passed++;
  else failed++;
}

console.log(`\n${'='.repeat(40)}\nRESULT: ${passed} PASS / ${failed} FAIL`);
const outPath = path.join(__dirname, `multi-turn-results-${new Date().toISOString().slice(0, 10)}.json`);
await fs.writeFile(outPath, JSON.stringify({ base_url: BASE_URL, ts: new Date().toISOString(), results: allResults }, null, 2));
console.log(`Details written to: ${outPath}`);

process.exit(failed > 0 ? 1 : 0);
