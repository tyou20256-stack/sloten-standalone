#!/usr/bin/env node
// Apply migrations to D1.
//
// Each migration file is expected to be idempotent (IF NOT EXISTS / @idempotent),
// but as of 2026-05-13 we additionally track applied migrations in
// `_schema_migrations` so non-idempotent migrations (schema-rebuilds for type
// changes — e.g. 027-ai-logs-uuid which uses DROP+RENAME) can be safely skipped
// on re-run. Once a migration filename is recorded as applied, it is not
// executed again.
//
// Wrangler configs: passes --config wrangler.toml unless WRANGLER_CONFIG=path
// is set in the environment. The default --remote target is the prod DB; for
// staging-bk pass --config wrangler.staging-bk.toml manually.
//
// Usage:
//   node scripts/apply-migrations.mjs                            # local D1
//   node scripts/apply-migrations.mjs --remote                   # remote D1 (prod)
//   WRANGLER_CONFIG=wrangler.staging-bk.toml node scripts/apply-migrations.mjs --remote
//   node scripts/apply-migrations.mjs --force                    # ignore tracker, re-apply all

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const REMOTE = process.argv.includes('--remote');
const FORCE = process.argv.includes('--force');
const MIGRATIONS_DIR = 'migrations';
const DB_BINDING_NAME = 'sloten_standalone_db';
const WRANGLER_CONFIG = process.env.WRANGLER_CONFIG || '';

const wranglerFlags = [
  REMOTE ? '--remote' : '--local',
  WRANGLER_CONFIG ? `--config ${WRANGLER_CONFIG}` : '',
].filter(Boolean).join(' ');

function d1Exec(commandOrFile, { isFile = false } = {}) {
  const arg = isFile ? `--file=${commandOrFile}` : `--command="${commandOrFile.replace(/"/g, '\\"')}"`;
  return execSync(`wrangler d1 execute ${DB_BINDING_NAME} ${wranglerFlags} ${arg}`, { stdio: 'pipe' });
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Applying ${files.length} migrations to ${DB_BINDING_NAME} (${REMOTE ? 'remote' : 'local'})${WRANGLER_CONFIG ? ` via ${WRANGLER_CONFIG}` : ''}...`);

// Ensure the tracker table exists. We do this inline (not as a migration)
// because the tracker is meta — it must exist before we can consult it.
try {
  d1Exec(
    `CREATE TABLE IF NOT EXISTS _schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`,
  );
} catch (e) {
  console.error('Failed to create _schema_migrations:', e.stdout?.toString() || e.message);
  process.exit(1);
}

// Collect set of already-applied migration names (unless --force).
let appliedSet = new Set();
if (!FORCE) {
  try {
    const out = d1Exec(`SELECT name FROM _schema_migrations;`).toString();
    // wrangler renders D1 result as JSON-ish text; extract `"name":"..."` matches.
    const matches = out.matchAll(/"name"\s*:\s*"([^"]+)"/g);
    for (const m of matches) appliedSet.add(m[1]);
  } catch (e) {
    // First-run case (or transient failure): treat as empty set.
    console.warn('Note: could not read _schema_migrations — applying all:', e?.message);
  }
}

let appliedCount = 0;
let skippedCount = 0;

for (const f of files) {
  const path = join(MIGRATIONS_DIR, f);
  if (appliedSet.has(f)) {
    console.log(`  ${f} ... SKIP (already applied)`);
    skippedCount++;
    continue;
  }
  process.stdout.write(`  ${f} ... `);
  try {
    d1Exec(path, { isFile: true });
    // Record application — best-effort, won't roll back the migration on insert failure.
    d1Exec(`INSERT OR IGNORE INTO _schema_migrations (name) VALUES ('${f.replace(/'/g, "''")}');`);
    console.log('OK');
    appliedCount++;
  } catch (e) {
    console.log('FAILED');
    console.error(e.stdout?.toString() || e.message);
    process.exit(1);
  }
}

console.log(`Done — applied ${appliedCount}, skipped ${skippedCount} (already applied).`);
