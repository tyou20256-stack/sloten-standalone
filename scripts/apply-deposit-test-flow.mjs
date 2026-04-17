#!/usr/bin/env node
// Insert (or update) the deposit-test bot flow into D1 (staging-bk remote).
// Usage: node scripts/apply-deposit-test-flow.mjs

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const WRANGLER = 'npx wrangler';
const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const SEED = 'seeds/seed-flow-deposit-test.json';
const TMP_SQL = 'seeds/_apply-deposit-test.sql';

const flow = JSON.parse(readFileSync(SEED, 'utf8'));

// SQL-escape single quotes by doubling.
const esc = (v) => String(v == null ? '' : v).replace(/'/g, "''");
const stepsJson = JSON.stringify(flow.steps);

const sql = `
DELETE FROM bot_flows WHERE tenant_id = 'tenant_default' AND name = '${esc(flow.name)}';
INSERT INTO bot_flows (tenant_id, name, description, trigger_type, trigger_value, start_step_id, steps, priority, is_active)
VALUES ('tenant_default', '${esc(flow.name)}', '${esc(flow.description)}',
        '${esc(flow.trigger_type)}', '${esc(flow.trigger_value)}',
        '${esc(flow.start_step_id)}', '${esc(stepsJson)}',
        ${Number(flow.priority) || 0}, ${flow.is_active ? 1 : 0});
SELECT id, name, is_active, priority FROM bot_flows WHERE name = '${esc(flow.name)}';
`.trim();

writeFileSync(TMP_SQL, sql);

try {
  console.log(`Applying flow "${flow.name}" to ${DB} (remote)...`);
  const out = execSync(
    `${WRANGLER} d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP_SQL}`,
    { stdio: 'pipe' },
  );
  console.log(out.toString());
  console.log('OK');
} catch (e) {
  console.error('FAILED');
  console.error(e.stdout?.toString() || e.stderr?.toString() || e.message);
  process.exit(1);
} finally {
  try { unlinkSync(TMP_SQL); } catch (_) {}
}
