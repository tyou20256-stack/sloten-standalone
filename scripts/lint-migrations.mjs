// Migration SQL linter — flags destructive changes that need careful review.
//
// Detects:
//   1) DROP TABLE / DROP COLUMN without backup directive comment
//   2) ALTER TABLE ... DROP / RENAME (potentially data-losing)
//   3) DELETE FROM without WHERE (mass deletion)
//   4) UPDATE without WHERE
//   5) Hard-coded production-looking IDs / emails
//
// This is a heuristic linter — false positives expected. Use the comment
// directive `-- MIGRATION-LINT: backup-taken` to acknowledge a destructive
// migration is intentional.
//
// Usage:
//   node scripts/lint-migrations.mjs                # lint all
//   node scripts/lint-migrations.mjs migrations/024-fts5-trigram.sql

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, '..', 'migrations');

const target = process.argv[2];
const files = target
  ? [path.resolve(target)]
  : (await fs.readdir(MIG_DIR)).filter((f) => f.endsWith('.sql')).map((f) => path.join(MIG_DIR, f));

console.log(`Linting ${files.length} migration(s)...`);

const issues = [];
for (const file of files) {
  const sql = await fs.readFile(file, 'utf8');
  const name = path.basename(file);
  // Acknowledgment markers (any of these signals "destructive ops are intentional"):
  //   `-- MIGRATION-LINT: backup-taken` — explicit ack
  //   `-- MIGRATION-LINT: safe`         — destructive ops verified safe
  //   `-- @idempotent`                  — convention used in existing migrations
  //                                       for FTS5 DROP+CREATE patterns
  const ack = sql.includes('MIGRATION-LINT: backup-taken')
    || sql.includes('MIGRATION-LINT: safe')
    || /^--\s*@idempotent/m.test(sql);

  // 1) DROP TABLE / DROP INDEX
  if (/\bDROP\s+(TABLE|INDEX)\b/i.test(sql) && !ack) {
    issues.push(`[${name}] DROP TABLE/INDEX without backup-taken acknowledgment`);
  }

  // 2) ALTER TABLE ... DROP / RENAME
  if (/\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME)\b/i.test(sql) && !ack) {
    issues.push(`[${name}] ALTER TABLE DROP/RENAME without backup-taken acknowledgment`);
  }

  // 3) DELETE FROM without WHERE
  // Match `DELETE FROM tbl;` or `DELETE FROM tbl<EOF>` (no WHERE clause)
  const deletes = sql.match(/DELETE\s+FROM\s+\w+\s*(?!WHERE)/gi) || [];
  for (const d of deletes) {
    // Verify there's no WHERE within reasonable distance
    const idx = sql.indexOf(d);
    const next200 = sql.slice(idx, idx + 200);
    if (!/\bWHERE\b/i.test(next200) && !ack) {
      issues.push(`[${name}] DELETE FROM without WHERE: "${d.trim()}"`);
    }
  }

  // 4) UPDATE without WHERE — same pattern
  const updates = sql.match(/UPDATE\s+\w+\s+SET[^;]+/gi) || [];
  for (const u of updates) {
    if (!/\bWHERE\b/i.test(u) && !ack) {
      issues.push(`[${name}] UPDATE without WHERE: "${u.slice(0, 60)}..."`);
    }
  }

  // 5) Hardcoded production-looking values
  if (/admin@(?!sloten\.local|test|example)/i.test(sql) && !ack) {
    issues.push(`[${name}] hardcoded production-looking email — verify intent`);
  }
}

console.log('');
if (issues.length === 0) {
  console.log('✓ Migration lint PASSED');
  process.exit(0);
}
console.log(`✗ ${issues.length} issue(s):`);
for (const i of issues) console.log(`  - ${i}`);
console.log('');
console.log('Add `-- MIGRATION-LINT: backup-taken` to acknowledge intentional destructive ops.');
process.exit(1);
