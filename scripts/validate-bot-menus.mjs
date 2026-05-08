// Bot menu validator — static analysis of bot_menus.options JSON.
// Detects:
//   1) Empty/duplicate options (UI confusion risk)
//   2) Options with neither `next` nor `value` (dead clicks)
//   3) Inconsistent emoji-prefix conventions
//   4) Menus without keywords (only reachable via direct navigation)
//
// Usage:
//   node scripts/validate-bot-menus.mjs

import { execSync } from 'node:child_process';

const cmd = `npx wrangler d1 execute sloten_standalone_db_staging_bk --config wrangler.staging-bk.toml --remote --command "SELECT id, tenant_id, name, trigger_type, trigger_value, prompt, items FROM bot_menus WHERE is_active = 1" --json`;
const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const rows = JSON.parse(out)[0]?.results || [];
console.log(`Active bot menus: ${rows.length}`);

const issues = [];

for (const row of rows) {
  let opts;
  try { opts = JSON.parse(row.items); }
  catch (e) { issues.push(`[${row.name}] items JSON parse error: ${e.message}`); continue; }

  if (!Array.isArray(opts) || opts.length === 0) {
    issues.push(`[${row.name}] empty items`);
    continue;
  }

  // Duplicate values
  const valueCount = {};
  for (const o of opts) {
    if (o.value) valueCount[o.value] = (valueCount[o.value] || 0) + 1;
  }
  for (const [v, n] of Object.entries(valueCount)) {
    if (n > 1) issues.push(`[${row.name}] duplicate option value "${v}" (${n}x)`);
  }

  // Duplicate titles (case-sensitive — emojis make this surprisingly common)
  const titleCount = {};
  for (const o of opts) {
    const t = (o.title || '').trim();
    if (t) titleCount[t] = (titleCount[t] || 0) + 1;
  }
  for (const [t, n] of Object.entries(titleCount)) {
    if (n > 1) issues.push(`[${row.name}] duplicate option title "${t}" (${n}x)`);
  }

  // Dead-click options
  for (const o of opts) {
    if (!o.title) issues.push(`[${row.name}] option missing title: ${JSON.stringify(o)}`);
    if (!o.value && !o.next) issues.push(`[${row.name}] option "${o.title}" has neither value nor next (dead click)`);
  }

  // Trigger sanity — keyword menus need a trigger_value
  if (row.trigger_type === 'keyword' && !row.trigger_value) {
    issues.push(`[${row.name}] trigger_type='keyword' but trigger_value empty (unreachable)`);
  }

  // Mixed emoji conventions: some titles start with emoji, some don't.
  const startEmoji = (t) => /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(t);
  const withEmoji = opts.filter((o) => startEmoji(o.title || '')).length;
  const withoutEmoji = opts.filter((o) => o.title && !startEmoji(o.title)).length;
  if (withEmoji > 0 && withoutEmoji > 0 && Math.min(withEmoji, withoutEmoji) >= 2) {
    issues.push(`[${row.name}] inconsistent emoji prefix: ${withEmoji} with, ${withoutEmoji} without`);
  }
}

console.log('');
if (issues.length === 0) {
  console.log('✓ Bot menu validation PASSED — no issues');
  process.exit(0);
}
console.log(`✗ ${issues.length} issue(s) found:`);
for (const i of issues) console.log(`  - ${i}`);
process.exit(1);
