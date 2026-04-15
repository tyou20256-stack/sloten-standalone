#!/usr/bin/env node
// Syntax-check all .mjs files with node --check.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = [...walk('src'), ...walk('scripts')];
let failed = 0;
for (const f of files) {
  try {
    execSync(`node --check ${f}`, { stdio: 'pipe' });
    console.log(`  OK   ${f}`);
  } catch (e) {
    console.log(`  FAIL ${f}`);
    console.log(e.stderr?.toString() || e.message);
    failed++;
  }
}
if (failed) {
  console.log(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} files pass syntax check.`);
