#!/usr/bin/env node
// Add the missing transfer_to_agent handoff step and wire every option whose
// value is 'transfer_to_agent' to point at it. Without this, all "🙋
// オペレーターと話す" buttons silently end the flow and the customer gets no
// response (the AI welcome fallback then kicks in on the next message).
//
// Usage: node scripts/add-transfer-to-agent.mjs

import { writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const WRANGLER = 'npx wrangler';
const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const FLOW_NAME = 'sloten-main';
const TMP_SQL = 'seeds/_add-transfer.sql';

// The flow engine's handoff branch emits step.note as a customer-facing
// message and then sets conversation.status='open' + clears flow_state so
// follow-up messages reach staff. Match production worker-with-ai.js exactly.
const transferStep = {
  id: 'transfer_to_agent',
  type: 'handoff',
  note: '🙋 オペレーターにお繋ぎします。\n\n順番にご対応しておりますので、少々お待ちください。',
};

// Pull current flow.
console.log(`Fetching current ${FLOW_NAME} flow...`);
const rawOut = execSync(
  `${WRANGLER} d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT id, steps FROM bot_flows WHERE name='${FLOW_NAME}' LIMIT 1"`,
  { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 },
).toString();

const row = JSON.parse(rawOut)[0]?.results?.[0];
if (!row) { console.error('Flow not found'); process.exit(1); }
const flowId = row.id;
const steps = JSON.parse(row.steps);
console.log(`Loaded ${steps.length} steps`);

// Remove any pre-existing transfer_to_agent step to make this idempotent.
const filtered = steps.filter((s) => s.id !== 'transfer_to_agent');

// Rewrite every option with value==='transfer_to_agent' to point next at it.
let rewroteCount = 0;
for (const s of filtered) {
  if (!Array.isArray(s.options)) continue;
  for (const o of s.options) {
    if (o && o.value === 'transfer_to_agent') {
      if (o.next !== 'transfer_to_agent') { o.next = 'transfer_to_agent'; rewroteCount++; }
      // Don't pollute the business var with the literal step id.
      o.skip_var = true;
    }
  }
}
console.log(`Rewired ${rewroteCount} options -> transfer_to_agent`);

// Append the new handoff step.
filtered.push(transferStep);
console.log(`Final step count: ${filtered.length}`);

const stepsJson = JSON.stringify(filtered);
const esc = (s) => s.replace(/'/g, "''");
const sql = `UPDATE bot_flows SET steps='${esc(stepsJson)}', updated_at=datetime('now') WHERE id=${flowId};`;

writeFileSync(TMP_SQL, sql);
try {
  console.log('Applying to D1...');
  execSync(
    `${WRANGLER} d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP_SQL}`,
    { stdio: 'inherit', maxBuffer: 20 * 1024 * 1024 },
  );
  console.log('OK');
} finally {
  try { unlinkSync(TMP_SQL); } catch (_) {}
}
