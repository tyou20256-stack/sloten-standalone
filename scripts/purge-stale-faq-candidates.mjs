#!/usr/bin/env node
// Purge pending faq_candidates rows that match the expanded filter rules
// (transaction IDs, account IDs, long digit strings, deposit keywords).
// Approved/rejected rows are left alone — only pending rows are touched.
//
// Usage: node scripts/purge-stale-faq-candidates.mjs [--apply]
//   Without --apply: dry-run, prints a table + count.
//   With    --apply: deletes matching rows from D1.

import { execSync } from 'node:child_process';
import { shouldRejectFaqPair } from '../src/extractor.mjs';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const APPLY = process.argv.includes('--apply');

const raw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT id, question, answer, status FROM faq_candidates WHERE status='pending' ORDER BY id"`,
  { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
).toString();

const rows = JSON.parse(raw)[0]?.results || [];
console.log(`Scanning ${rows.length} pending candidates...`);

const toDelete = [];
const reasons = { deposit: 0, transactional: 0, long_digit: 0, account_id: 0 };
for (const r of rows) {
  const reason = shouldRejectFaqPair(r.question, r.answer);
  if (reason) {
    toDelete.push({ id: r.id, reason, q: (r.question || '').slice(0, 60) });
    reasons[reason]++;
  }
}

console.log(`Would delete ${toDelete.length} rows:`);
console.log('  by reason:', reasons);
if (toDelete.length) {
  console.log('  sample:');
  for (const r of toDelete.slice(0, 10)) console.log(`    id=${r.id} [${r.reason}] ${r.q}`);
  if (toDelete.length > 10) console.log(`    ...and ${toDelete.length - 10} more`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}

// Batch delete via multiple DELETE statements (D1 handles up to a few
// thousand IDs per execute comfortably).
const batches = [];
const ids = toDelete.map((r) => r.id);
for (let i = 0; i < ids.length; i += 500) batches.push(ids.slice(i, i + 500));
for (const batch of batches) {
  const sql = `DELETE FROM faq_candidates WHERE id IN (${batch.join(',')});`;
  execSync(
    `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --command "${sql}"`,
    { stdio: 'inherit' },
  );
}
console.log(`\nDeleted ${ids.length} stale candidates.`);
