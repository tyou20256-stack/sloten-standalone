#!/usr/bin/env node
// Apply migrations to D1. Each file is idempotent (uses IF NOT EXISTS).
// Usage:
//   node scripts/apply-migrations.mjs           # local D1
//   node scripts/apply-migrations.mjs --remote  # remote D1

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const REMOTE = process.argv.includes('--remote');
const MIGRATIONS_DIR = 'migrations';
const DB_BINDING_NAME = 'sloten_standalone_db';

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Applying ${files.length} migrations to ${DB_BINDING_NAME} (${REMOTE ? 'remote' : 'local'})...`);

for (const f of files) {
  const path = join(MIGRATIONS_DIR, f);
  process.stdout.write(`  ${f} ... `);
  try {
    const flags = REMOTE ? '--remote' : '--local';
    execSync(`wrangler d1 execute ${DB_BINDING_NAME} ${flags} --file=${path}`, { stdio: 'pipe' });
    console.log('OK');
  } catch (e) {
    console.log('FAILED');
    console.error(e.stdout?.toString() || e.message);
    process.exit(1);
  }
}

console.log('All migrations applied.');
