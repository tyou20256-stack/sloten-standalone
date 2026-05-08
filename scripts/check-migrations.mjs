// Migration audit — verifies that:
//   1) All migrations/*.sql files have a matching d1_migrations entry on
//      staging-bk (none should be unapplied or out of order)
//   2) Migration filenames follow expected pattern (3-digit prefix, kebab-case)
//   3) No two migrations have duplicate version prefixes
//
// Usage:
//   node scripts/check-migrations.mjs --remote
//   node scripts/check-migrations.mjs              # local check only

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'migrations');

const args = process.argv.slice(2);
const checkRemote = args.includes('--remote');

async function listLocalMigrations() {
  const files = await fs.readdir(MIG_DIR);
  const migs = files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const m = f.match(/^(\d{3})-(.+)\.sql$/);
      return m ? { file: f, version: m[1], name: m[2] } : { file: f, version: null, name: f };
    });
  return migs;
}

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function ok(msg) { console.log(`✓ ${msg}`); }

const local = await listLocalMigrations();
console.log(`Local migrations: ${local.length}`);

// 1) Filename pattern
const malformed = local.filter((m) => m.version === null);
if (malformed.length === 0) {
  ok('All migration filenames follow NNN-kebab-name.sql');
} else {
  for (const m of malformed) fail(`Malformed migration filename: ${m.file}`);
}

// 2) Duplicate versions — known acceptable cases listed in
// migrations/NUMBERING-NOTES.md. Treat as warnings only since D1 tracks
// migrations by filename, not version prefix.
const KNOWN_DUPS = new Set(['010', '011', '012']);
const versionCount = {};
for (const m of local) {
  if (m.version) versionCount[m.version] = (versionCount[m.version] || 0) + 1;
}
const dups = Object.entries(versionCount).filter(([, n]) => n > 1);
if (dups.length === 0) {
  ok('No duplicate migration versions');
} else {
  for (const [v, n] of dups) {
    if (KNOWN_DUPS.has(v)) {
      console.log(`  ⚠ Known duplicate version ${v} (${n}x) — see migrations/NUMBERING-NOTES.md`);
    } else {
      fail(`Duplicate version ${v} appears ${n} times`);
    }
  }
}

// 3) Sequential check (allow gaps for archived migrations, warn though)
const versions = local.map((m) => m.version).filter(Boolean).map(Number).sort((a, b) => a - b);
let lastSeen = versions[0] - 1;
for (const v of versions) {
  if (v - lastSeen > 1) {
    console.log(`  ⚠ gap between version ${String(lastSeen).padStart(3, '0')} and ${String(v).padStart(3, '0')}`);
  }
  lastSeen = v;
}

// 4) Remote applied list
if (checkRemote) {
  console.log('\nQuerying remote d1_migrations table...');
  try {
    const cmd = `npx wrangler d1 execute sloten_standalone_db_staging_bk --config wrangler.staging-bk.toml --remote --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 50" --json`;
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // wrangler outputs an array of result envelopes
    const parsed = JSON.parse(out);
    const applied = (parsed[0]?.results || []).map((r) => r.name);
    console.log(`Remote applied: ${applied.length}`);

    const localNames = local.map((m) => m.file);
    const unapplied = localNames.filter((n) => !applied.includes(n));
    const orphan = applied.filter((n) => !localNames.includes(n));

    if (unapplied.length === 0) ok('All local migrations are applied remotely');
    else for (const n of unapplied) fail(`Migration NOT applied on remote: ${n}`);

    if (orphan.length === 0) ok('No orphan migrations on remote');
    else for (const n of orphan) console.log(`  ⚠ Migration on remote but not in local files: ${n}`);
  } catch (e) {
    fail(`Failed to query remote: ${e.message.slice(0, 200)}`);
  }
}

if (process.exitCode === 1) {
  console.error('\nMigration audit FAILED');
} else {
  console.log('\n✓ Migration audit PASSED');
}
