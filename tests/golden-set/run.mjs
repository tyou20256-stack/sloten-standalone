#!/usr/bin/env node
// Golden Set evaluation runner for sloten-standalone AI chat.
// Usage: node tests/golden-set/run.mjs [--base-url URL] [--delay MS] [--only CATEGORY]
//
// Sends each query via the Widget API, scores against expected/forbidden phrases,
// and writes results-YYYYMMDD.json + console summary.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = path.join(__dirname, 'queries.json');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const BASE_URL = getArg('--base-url', 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev');
const DELAY_MS = parseInt(getArg('--delay', '2000'), 10);
const ONLY_CAT = getArg('--only', null);

// --- Widget API helpers ---
async function createSession() {
  const c = await fetch(`${BASE_URL}/api/widget/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: 'tenant_default' }),
  }).then((r) => r.json());
  const conv = await fetch(`${BASE_URL}/api/widget/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sloten-Contact-Token': c.contact_token,
    },
    body: JSON.stringify({ contact_id: c.contact.id, tenant_id: 'tenant_default' }),
  }).then((r) => r.json());
  return { contactToken: c.contact_token, conversationId: conv.conversation.id };
}

async function sendMessage(contactToken, conversationId, content) {
  const r = await fetch(`${BASE_URL}/api/widget/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sloten-Contact-Token': contactToken,
    },
    body: JSON.stringify({ sender_type: 'customer', content }),
  }).then((res) => res.json());
  return r;
}

// --- Scoring ---
function score(query, botReplies) {
  const combined = (botReplies || []).map((r) => r.content || '').join('\n');
  const handoff = (botReplies || []).some((r) =>
    r.content_attributes?.handoff
    || r.content?.includes('担当者より')
    || r.content?.includes('担当者にて')
    || r.content?.includes('おつなぎ')
    || r.content?.includes('お繋ぎ')
    || r.content?.includes('相談窓口')
    || r.content?.includes('お待ちくださいませ'),
  );
  const jumpIds = (botReplies || [])
    .filter((r) => r.content_attributes?.jumped_to)
    .map((r) => r.content_attributes.jumped_to);

  const issues = [];

  // Expected phrases (OR — any match is enough)
  if (query.expected_phrases.length > 0) {
    const found = query.expected_phrases.some((p) => combined.includes(p));
    if (!found) issues.push(`MISSING expected: [${query.expected_phrases.join(', ')}]`);
  }

  // Forbidden phrases (AND — none should appear)
  for (const f of query.forbidden_phrases) {
    if (combined.includes(f)) issues.push(`FORBIDDEN found: "${f}"`);
  }

  // Handoff check
  if (query.expected_handoff && !handoff) {
    issues.push('Expected handoff but not detected');
  }

  // Jump check
  if (query.expected_jump && !jumpIds.includes(query.expected_jump)) {
    // Soft check — jump might be in flow_state, not always in bot_replies
    // Only flag if we got bot_replies but no jump indication
    if (botReplies && botReplies.length > 0) {
      // Check if menu content suggests the jump happened
      const menuHint = combined.includes('入金') || combined.includes('出金') || combined.includes('ボーナス');
      if (!menuHint) {
        issues.push(`Expected jump to "${query.expected_jump}" — not detected`);
      }
    }
  }

  // Empty response check
  if (!combined.trim()) {
    issues.push('Empty bot response');
  }

  return {
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    issues,
    response_preview: combined.slice(0, 200),
    handoff_detected: handoff,
    jump_ids: jumpIds,
  };
}

// --- Main ---
async function main() {
  const queries = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8'));
  const active = queries.filter((q) => {
    if (q.source === 'tbd_bk_team') return false;
    if (ONLY_CAT && q.category !== ONLY_CAT) return false;
    return true;
  });

  console.log(`\n========================================`);
  console.log(`  Golden Set Evaluation`);
  console.log(`  Base: ${BASE_URL}`);
  console.log(`  Queries: ${active.length} active / ${queries.length} total`);
  console.log(`  Delay: ${DELAY_MS}ms`);
  console.log(`========================================\n`);

  const results = [];

  for (const q of active) {
    process.stdout.write(`  ${q.id} [${q.category}] "${q.input.slice(0, 40)}" ... `);
    try {
      const { contactToken, conversationId } = await createSession();
      const reply = await sendMessage(contactToken, conversationId, q.input);
      const botReplies = reply.bot_replies || (reply.bot_reply ? [reply.bot_reply] : []);
      const s = score(q, botReplies);
      results.push({ ...q, result: s });
      console.log(s.status === 'PASS' ? '✓ PASS' : `✗ FAIL ${s.issues.join(' | ')}`);
    } catch (e) {
      results.push({ ...q, result: { status: 'ERROR', issues: [e.message], response_preview: '', handoff_detected: false, jump_ids: [] } });
      console.log(`✗ ERROR: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // Skipped (tbd)
  const skipped = queries.filter((q) => q.source === 'tbd_bk_team');

  // --- Summary ---
  const pass = results.filter((r) => r.result.status === 'PASS').length;
  const fail = results.filter((r) => r.result.status === 'FAIL').length;
  const err = results.filter((r) => r.result.status === 'ERROR').length;
  const total = results.length;

  console.log(`\n========================================`);
  console.log(`  RESULTS: ${pass} PASS / ${fail} FAIL / ${err} ERROR / ${skipped.length} SKIP`);
  console.log(`  Score: ${total > 0 ? Math.round((pass / total) * 100) : 0}%`);
  console.log(`========================================\n`);

  // Category breakdown
  const cats = {};
  for (const r of results) {
    if (!cats[r.category]) cats[r.category] = { pass: 0, fail: 0, error: 0 };
    cats[r.category][r.result.status.toLowerCase()]++;
  }
  console.log('  Category breakdown:');
  for (const [cat, c] of Object.entries(cats)) {
    const catTotal = c.pass + c.fail + c.error;
    console.log(`    ${cat}: ${c.pass}/${catTotal} PASS`);
  }

  // Failures detail
  if (fail + err > 0) {
    console.log('\n  Failures:');
    for (const r of results.filter((r) => r.result.status !== 'PASS')) {
      console.log(`    ${r.id} [${r.category}] "${r.input.slice(0, 30)}"`);
      for (const iss of r.result.issues) console.log(`      - ${iss}`);
      if (r.result.response_preview) console.log(`      Response: "${r.result.response_preview.slice(0, 100)}"`);
    }
  }

  // --- Write results file ---
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outPath = path.join(__dirname, `results-${ts}.json`);
  const output = {
    timestamp: new Date().toISOString(),
    base_url: BASE_URL,
    summary: { total, pass, fail, error: err, skip: skipped.length, score_pct: total > 0 ? Math.round((pass / total) * 100) : 0 },
    category_breakdown: cats,
    results,
    skipped: skipped.map((q) => ({ id: q.id, category: q.category, input: q.input })),
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n  Results written to: ${outPath}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
