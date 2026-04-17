#!/usr/bin/env node
// Purge faq rows that match the expanded filter rules (transaction IDs,
// account IDs, long digit strings, deposit keywords, amount mentions).
// Mirrors scripts/purge-stale-faq-candidates.mjs but targets the approved
// `faq` table.
//
// Usage: node scripts/purge-stale-faq.mjs [--apply]
//   Without --apply: dry-run with sample + count.
//   With    --apply: deletes matching rows from D1.

import { execSync } from 'node:child_process';
import { shouldRejectFaqPair } from '../src/extractor.mjs';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const APPLY = process.argv.includes('--apply');

const reject = shouldRejectFaqPair;

const raw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT id, question, answer FROM faq ORDER BY id"`,
  { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
).toString();

const rows = JSON.parse(raw)[0]?.results || [];
console.log(`Scanning ${rows.length} faq rows...`);

const toDelete = [];
const reasons = { deposit: 0, transactional: 0, long_digit: 0, account_id: 0, amount: 0 };
for (const r of rows) {
  const reason = reject(r.question, r.answer);
  if (reason) {
    toDelete.push({ id: r.id, reason, q: (r.question || '').slice(0, 60) });
    reasons[reason]++;
  }
}

console.log(`Would delete ${toDelete.length} rows:`);
console.log('  by reason:', reasons);
if (toDelete.length) {
  console.log('  sample:');
  for (const r of toDelete.slice(0, 15)) console.log(`    id=${r.id} [${r.reason}] ${r.q}`);
  if (toDelete.length > 15) console.log(`    ...and ${toDelete.length - 15} more`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}

const ids = toDelete.map((r) => r.id);
for (let i = 0; i < ids.length; i += 500) {
  const batch = ids.slice(i, i + 500);
  const sql = `DELETE FROM faq WHERE id IN (${batch.join(',')});`;
  execSync(
    `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --command "${sql}"`,
    { stdio: 'inherit' },
  );
}
console.log(`\nDeleted ${ids.length} stale faq rows.`);
