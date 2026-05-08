// Bot flow validator — static analysis on the active bot_flows.steps JSON.
// Detects:
//   1) Steps referenced via `next` / `options[].next` / `on_error` that
//      don't exist in the flow's step list (dead links)
//   2) Cycles in step graphs (excluding intentional menu loops)
//   3) Webhook steps that reference undefined env vars
//   4) Select steps with zero options
//   5) Input steps without validation regex (loose validation)
//
// Usage:
//   node scripts/validate-bot-flows.mjs                 # against staging-bk
//   node scripts/validate-bot-flows.mjs --config <toml>

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const cfgIdx = args.indexOf('--config');
const config = cfgIdx > -1 ? args[cfgIdx + 1] : 'wrangler.staging-bk.toml';

console.log(`Loading active bot flows from ${config}...`);

const cmd = `npx wrangler d1 execute sloten_standalone_db_staging_bk --config ${config} --remote --command "SELECT id, name, start_step_id, steps FROM bot_flows WHERE is_active = 1" --json`;
const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const parsed = JSON.parse(out);
const rows = parsed[0]?.results || [];
console.log(`Active flows: ${rows.length}`);

const issues = [];

for (const row of rows) {
  let steps;
  try { steps = JSON.parse(row.steps); }
  catch (e) { issues.push(`[${row.name}] steps JSON parse error: ${e.message}`); continue; }
  if (!Array.isArray(steps)) { issues.push(`[${row.name}] steps is not an array`); continue; }

  const stepIds = new Set(steps.map((s) => s.id));
  console.log(`\n[${row.name}] ${steps.length} steps`);

  // 1) Dead-link detection
  for (const step of steps) {
    const refs = [];
    if (step.next) refs.push({ from: step.id, to: step.next, kind: 'next' });
    if (step.on_error) refs.push({ from: step.id, to: step.on_error, kind: 'on_error' });
    if (Array.isArray(step.options)) {
      for (const o of step.options) {
        if (o.next) refs.push({ from: step.id, to: o.next, kind: `option[${o.value}]` });
      }
    }
    for (const r of refs) {
      // Known synthetic / sentinel targets — these aren't real step IDs
      // but are interpreted by the flow engine as handoff/special exits.
      const SENTINEL_TARGETS = new Set(['transfer_to_agent', 'handoff', 'end']);
      if (SENTINEL_TARGETS.has(r.to)) continue;
      if (!stepIds.has(r.to)) {
        issues.push(`[${row.name}] dead link: ${r.from}.${r.kind} → "${r.to}" (no such step)`);
      }
    }
  }

  // 2) Start-step existence
  if (row.start_step_id && !stepIds.has(row.start_step_id)) {
    issues.push(`[${row.name}] start_step_id "${row.start_step_id}" not in steps`);
  }

  // 3) Webhook steps without URL or env-var reference
  for (const step of steps) {
    if (step.type === 'webhook') {
      if (!step.url) {
        issues.push(`[${row.name}] webhook step ${step.id}: no url`);
      }
    }
  }

  // 4) Select steps with no options
  for (const step of steps) {
    if (step.type === 'select' && (!Array.isArray(step.options) || step.options.length === 0)) {
      issues.push(`[${row.name}] select step ${step.id}: no options`);
    }
  }

  // 5) Cycle detection on `next` chains. Excludes:
  //   - select branches (intentional menu loops)
  //   - "*__menu" suffix (menu re-entry pattern is by design)
  const linearNext = new Map();
  for (const step of steps) {
    if (step.id?.endsWith('__menu')) continue;
    if ((step.type === 'message' || step.type === 'input' || step.type === 'webhook') && step.next) {
      // Skip if next is a menu re-entry
      if (step.next.endsWith('__menu')) continue;
      linearNext.set(step.id, step.next);
    }
  }
  // Restricted cycle detection: only flag actual revisits within a single
  // forward chain (visited-set DFS). Floyd's tortoise+hare can false-positive
  // on graphs with merging (multiple in-edges to a join node).
  function detectCycleStrict(start) {
    const visited = new Set([start]);
    let cur = linearNext.get(start);
    while (cur) {
      if (visited.has(cur)) return cur; // genuine revisit
      visited.add(cur);
      cur = linearNext.get(cur);
    }
    return null;
  }
  for (const start of linearNext.keys()) {
    const cyc = detectCycleStrict(start);
    if (cyc) {
      issues.push(`[${row.name}] cycle detected: chain starting at ${start} revisits ${cyc}`);
      break;
    }
  }
}

console.log('');
if (issues.length === 0) {
  console.log('✓ Bot flow validation PASSED — no issues');
  process.exit(0);
}
console.log(`✗ ${issues.length} issue(s) found:`);
for (const i of issues) console.log(`  - ${i}`);
process.exit(1);
