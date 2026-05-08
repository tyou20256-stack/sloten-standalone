// Wrangler config drift detector
//
// Compares wrangler.toml (production target) against
// wrangler.staging-bk.toml (staging target) to surface configuration
// differences that could cause production surprises.
//
// Run:
//   node scripts/check-config-drift.mjs
//
// Exit code:
//   0 — no drift (only expected differences: name, database_id, KV ids)
//   1 — unexpected drift detected
//
// What's compared:
//   - Compatibility date / flags
//   - Triggers (cron schedule)
//   - [vars] keys (values can differ; presence cannot)
//   - Bindings type/binding-name (D1, KV, R2, Vectorize, AI, DO)
//
// What's INTENTIONALLY allowed to differ:
//   - name (different Worker identity)
//   - database_id (different D1)
//   - KV namespace ids
//   - Var values (e.g. PUBLIC_WORKER_URL)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

async function readToml(file) {
  const text = await fs.readFile(path.join(ROOT, file), 'utf8');
  return text;
}

// Tiny line-based TOML scanner — extracts known keys without a full parser.
// Sufficient for drift detection; not a generic TOML parser.
//
// Pre-processing: collapse multi-line arrays so single-line regex extraction
// works for `crons = [\n  "*..."\n]` style. Also handle inline comments.
function flattenMultilineArrays(toml) {
  // Match `key = [` opener and merge through closing `]`
  return toml.replace(/(=\s*\[)([^\]]*)/g, (_m, prefix, body) => {
    return prefix + body.replace(/\n/g, ' ').replace(/#[^\n]*/g, '');
  });
}

function extractKeys(rawToml) {
  const toml = flattenMultilineArrays(rawToml);
  const out = {
    compat_date: null,
    compat_flags: null,
    cron_triggers: [],
    var_keys: new Set(),
    bindings: { d1: [], kv: [], r2: [], vectorize: [], ai: false, do: [] },
  };
  let section = null;
  let inEnvOverride = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (sec) {
      section = sec[1];
      // wrangler.toml has [env.staging] / [env.production] sub-sections
      // — those describe a SEPARATE Worker target. Skip them so we only
      // compare the top-level (default/prod) config against staging-bk.
      inEnvOverride = section.startsWith('env.');
      continue;
    }
    if (inEnvOverride) continue;
    if (line.startsWith('compatibility_date')) {
      out.compat_date = line.split('=')[1]?.trim().replace(/['"]/g, '');
    }
    if (line.startsWith('compatibility_flags')) {
      out.compat_flags = line.split('=')[1]?.trim();
    }
    if (section?.endsWith('triggers')) {
      const m = line.match(/^crons\s*=\s*\[([^\]]+)\]/);
      if (m) {
        const crons = m[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
        out.cron_triggers.push(...crons);
      }
    }
    if (section?.endsWith('vars') || section === 'vars') {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
      if (m) out.var_keys.add(m[1]);
    }
    if (section?.includes('d1_databases')) {
      const m = line.match(/^binding\s*=\s*['"]([^'"]+)['"]/);
      if (m) out.bindings.d1.push(m[1]);
    }
    if (section?.includes('kv_namespaces')) {
      const m = line.match(/^binding\s*=\s*['"]([^'"]+)['"]/);
      if (m) out.bindings.kv.push(m[1]);
    }
    if (section?.includes('r2_buckets')) {
      const m = line.match(/^binding\s*=\s*['"]([^'"]+)['"]/);
      if (m) out.bindings.r2.push(m[1]);
    }
    if (section?.includes('vectorize')) {
      const m = line.match(/^binding\s*=\s*['"]([^'"]+)['"]/);
      if (m) out.bindings.vectorize.push(m[1]);
    }
    if (section?.includes('ai') && section.includes('binding')) {
      out.bindings.ai = true;
    }
    if (section?.includes('durable_objects')) {
      const m = line.match(/^name\s*=\s*['"]([^'"]+)['"]/);
      if (m) out.bindings.do.push(m[1]);
    }
  }
  return out;
}

function diff(prod, staging) {
  const issues = [];
  if (prod.compat_date !== staging.compat_date) {
    issues.push(`compat_date drift: prod=${prod.compat_date} staging=${staging.compat_date}`);
  }
  if (prod.compat_flags !== staging.compat_flags) {
    issues.push(`compat_flags drift: prod=${prod.compat_flags} staging=${staging.compat_flags}`);
  }
  // Cron — sets equal regardless of order
  const prodCron = [...prod.cron_triggers].sort().join('|');
  const stagingCron = [...staging.cron_triggers].sort().join('|');
  if (prodCron !== stagingCron) {
    issues.push(`cron drift: prod=[${prodCron}] staging=[${stagingCron}]`);
  }
  // Var KEYS only (values may differ)
  const onlyProd = [...prod.var_keys].filter((k) => !staging.var_keys.has(k));
  const onlyStaging = [...staging.var_keys].filter((k) => !prod.var_keys.has(k));
  if (onlyProd.length) issues.push(`vars only in prod: ${onlyProd.join(', ')}`);
  if (onlyStaging.length) issues.push(`vars only in staging: ${onlyStaging.join(', ')}`);
  // Bindings — names only
  for (const k of Object.keys(prod.bindings)) {
    const a = JSON.stringify(prod.bindings[k] ?? []);
    const b = JSON.stringify(staging.bindings[k] ?? []);
    if (a !== b) issues.push(`binding[${k}] drift: prod=${a} staging=${b}`);
  }
  return issues;
}

(async () => {
  const prod = extractKeys(await readToml('wrangler.toml'));
  const staging = extractKeys(await readToml('wrangler.staging-bk.toml'));
  const issues = diff(prod, staging);
  if (issues.length === 0) {
    console.log('✓ No config drift between wrangler.toml and wrangler.staging-bk.toml');
    process.exit(0);
  }
  console.error('✗ Config drift detected:');
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
})().catch((e) => { console.error(e); process.exit(2); });
