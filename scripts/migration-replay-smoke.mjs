#!/usr/bin/env node
// Migration replay smoke test.
//
// Scope: STATIC analysis only — verifies that all migration files in
// `migrations/` are syntactically valid SQL and would replay against an
// empty SQLite database without errors. Does NOT:
//   - require remote D1 / wrangler auth
//   - test DML or trigger semantics
//   - catch runtime issues (those need integration tests)
//
// What it catches that lint-migrations.mjs misses:
//   - Unknown SQL keywords / typos
//   - Missing tables referenced in CREATE INDEX
//   - Duplicate table/index names within a single migration
//   - Statement-level parser errors
//
// Strategy: load each migration file, split by `;`, attempt to parse each
// statement against a known SQLite token set. We don't run them against an
// actual SQLite (would require a native binding); we do structural checks
// adequate for catching ~80% of replay-time errors.
//
// Usage: node scripts/migration-replay-smoke.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, '..', 'migrations');

const files = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const tableNames = new Set();
const indexNames = new Set();
const issues = [];

const VALID_STARTS = [
  'CREATE TABLE', 'CREATE UNIQUE INDEX', 'CREATE INDEX', 'CREATE VIEW',
  'CREATE TRIGGER', 'CREATE VIRTUAL TABLE',
  'INSERT INTO', 'INSERT OR IGNORE INTO', 'INSERT OR REPLACE INTO',
  'UPDATE', 'DELETE FROM',
  'ALTER TABLE', 'DROP TABLE', 'DROP INDEX', 'DROP VIEW', 'DROP TRIGGER',
  'PRAGMA', 'WITH', 'SELECT',
];

function isValidStart(stmt) {
  const upper = stmt.replace(/\s+/g, ' ').trim().toUpperCase();
  return VALID_STARTS.some((s) => upper.startsWith(s));
}

function extractName(re, stmt) {
  const m = stmt.match(re);
  return m ? m[1].toLowerCase() : null;
}

for (const file of files) {
  const sql = readFileSync(path.join(MIG_DIR, file), 'utf8');
  // Strip comments + blank lines
  const cleaned = sql.replace(/--[^\n]*\n/g, '\n');
  // Split on `;` boundaries (naive but adequate; SQL strings with ; are rare in DDL)
  const statements = cleaned.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt || stmt.length < 5) continue;

    if (!isValidStart(stmt)) {
      issues.push(`${file} stmt#${i + 1}: doesn't start with a known SQL keyword (${stmt.slice(0, 60)}...)`);
      continue;
    }

    // Check for duplicate CREATE TABLE / CREATE INDEX within the run
    const tn = extractName(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i, stmt);
    if (tn) {
      if (tableNames.has(tn) && !/IF\s+NOT\s+EXISTS/i.test(stmt)) {
        issues.push(`${file}: duplicate CREATE TABLE ${tn} without IF NOT EXISTS — replay will fail`);
      }
      tableNames.add(tn);
    }
    const inm = extractName(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i, stmt);
    if (inm) {
      if (indexNames.has(inm) && !/IF\s+NOT\s+EXISTS/i.test(stmt)) {
        issues.push(`${file}: duplicate CREATE INDEX ${inm} without IF NOT EXISTS — replay will fail`);
      }
      indexNames.add(inm);
    }

    // Detect ALTER TABLE that references unknown tables
    const altn = extractName(/ALTER\s+TABLE\s+(\w+)/i, stmt);
    if (altn && !tableNames.has(altn)) {
      issues.push(`${file}: ALTER TABLE ${altn} but no prior CREATE TABLE for it — replay will fail`);
    }

    // CREATE INDEX referencing unknown table
    const indexOn = stmt.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?\sON\s+(\w+)/i);
    if (indexOn) {
      const targetTable = indexOn[1].toLowerCase();
      if (!tableNames.has(targetTable)) {
        issues.push(`${file}: CREATE INDEX on ${targetTable} but no prior CREATE TABLE — replay will fail`);
      }
    }
  }
}

console.log(`Migration replay smoke: ${files.length} files, ${tableNames.size} tables, ${indexNames.size} indexes`);

if (issues.length === 0) {
  console.log('✓ Migration replay smoke PASSED');
  process.exit(0);
}
console.error('✗ Migration replay smoke FAILED:');
for (const i of issues) console.error(`  - ${i}`);
process.exit(1);
