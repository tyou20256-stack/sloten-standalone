#!/usr/bin/env node
// Strip "🙋 オペレーターと話す" menu buttons from every active bot_flow and the
// handoff-fallback bot_menu.
//
// Why this exists:
//   The operator buttons are data, scattered across ~227 select-step options
//   in bot_flows 18-22 plus the handoff-fallback menu. Pure-SQL JSON surgery
//   over per-step variable array indices is impractical, and the full
//   sloten-main steps blob (>100 KB) exceeds D1's inline-SQL statement limit.
//   So we go through the worker admin API: PATCH /api/bot-flows/:id with the
//   cleaned `steps` array — D1 client binding sends it as a bound parameter,
//   bypassing the SQL-text size limit, and updateBotFlow re-validates it.
//
// Removal rule (title-based, conservative):
//   - bot_flows: drop any select option whose `title` includes
//     "オペレーターと話す". Options that merely route to value
//     `transfer_to_agent` but are NOT that button — e.g.
//     "💬 その他の方法で出金(チャット対応)" — are KEPT (they're a
//     withdrawal-method choice, not the operator button).
//   - handoff-fallback menu: drop the item titled "オペレーターにつなぐ".
//   The `transfer_to_agent` handoff STEP itself is left intact — it's still
//   the landing point for the kept withdrawal-chat option and for
//   keyword/RG/anger escalation (decideEscalation), which this script does
//   NOT touch.
//
// Idempotent: re-running after a clean pass removes 0 buttons.
//
// Usage:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   BASE_URL=https://sloten-standalone-staging-bk.rcc-aoki.workers.dev \
//   node scripts/strip-operator-buttons.mjs

const BASE = process.env.BASE_URL || 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tester@staging.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '6jr3aYmKDPb3U5De';
const DRY_RUN = process.argv.includes('--dry-run');

const OPERATOR_BUTTON_TITLE = 'オペレーターと話す';
const HANDOFF_MENU_ITEM_TITLE = 'オペレーターにつなぐ';

function isOperatorButton(opt) {
  return opt && typeof opt.title === 'string' && opt.title.includes(OPERATOR_BUTTON_TITLE);
}

// Walk every step, drop operator-button options. Returns [cleanedSteps, count].
function stripFlowSteps(steps) {
  let removed = 0;
  const cleaned = steps.map((step) => {
    if (!Array.isArray(step.options)) return step;
    const before = step.options.length;
    const options = step.options.filter((o) => !isOperatorButton(o));
    removed += before - options.length;
    return options.length === before ? step : { ...step, options };
  });
  return [cleaned, removed];
}

async function main() {
  // 1. Admin login.
  const lr = await fetch(`${BASE}/api/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': BASE, 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!lr.ok) { console.error(`login failed: ${lr.status}`); process.exit(1); }
  const cookie = (lr.headers.get('set-cookie') || '').match(/sloten_staff_session=[^;]+/)?.[0];
  if (!cookie) { console.error('no session cookie'); process.exit(1); }
  const H = { 'Content-Type': 'application/json', 'Cookie': cookie, 'Origin': BASE, 'Sec-Fetch-Site': 'same-origin' };

  let totalRemoved = 0;

  // 2. Every active bot_flow.
  const flowsRes = await fetch(`${BASE}/api/bot-flows`, { headers: H });
  const flowsBody = await flowsRes.json();
  const flows = flowsBody.flows || [];
  for (const f of flows) {
    const steps = Array.isArray(f.steps) ? f.steps : [];
    const [cleaned, removed] = stripFlowSteps(steps);
    if (removed === 0) {
      console.log(`flow ${f.id} ${f.name}: 0 operator buttons (already clean)`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`flow ${f.id} ${f.name}: WOULD remove ${removed} operator buttons`);
      totalRemoved += removed;
      continue;
    }
    const pr = await fetch(`${BASE}/api/bot-flows/${f.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ steps: cleaned }),
    });
    if (!pr.ok) {
      const t = await pr.text().catch(() => '');
      console.error(`flow ${f.id} ${f.name}: PATCH failed ${pr.status} ${t.slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`flow ${f.id} ${f.name}: removed ${removed} operator buttons ✓`);
    totalRemoved += removed;
  }

  // 3. handoff-fallback menu — drop the "オペレーターにつなぐ" item.
  const menusRes = await fetch(`${BASE}/api/bot-menus`, { headers: H });
  const menusBody = await menusRes.json();
  const menus = menusBody.menus || menusBody.bot_menus || [];
  for (const m of menus) {
    const items = Array.isArray(m.items) ? m.items
      : (typeof m.items === 'string' ? JSON.parse(m.items) : []);
    const kept = items.filter((it) => !(it && typeof it.title === 'string' && it.title.includes(HANDOFF_MENU_ITEM_TITLE)));
    if (kept.length === items.length) continue;
    if (DRY_RUN) {
      console.log(`menu ${m.id} ${m.name}: WOULD remove ${items.length - kept.length} operator item(s)`);
      totalRemoved += items.length - kept.length;
      continue;
    }
    const pr = await fetch(`${BASE}/api/bot-menus/${m.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ items: kept }),
    });
    if (!pr.ok) {
      const t = await pr.text().catch(() => '');
      console.error(`menu ${m.id} ${m.name}: PATCH failed ${pr.status} ${t.slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`menu ${m.id} ${m.name}: removed ${items.length - kept.length} operator item(s) ✓`);
    totalRemoved += items.length - kept.length;
  }

  console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}Total operator buttons ${DRY_RUN ? 'to remove' : 'removed'}: ${totalRemoved}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
