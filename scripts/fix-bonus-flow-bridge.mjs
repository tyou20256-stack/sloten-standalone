#!/usr/bin/env node
// Fix the bonus code → flow re-entry problem.
//
// Problem: After a bonus code matches and shows success_items buttons,
// clicking a button sends the value as text. But flow_state is NULL so the
// main flow (trigger ".*") catches it at welcome_message where it doesn't
// match any option → menu re-displays.
//
// Fix: For each bonus code with follow-up buttons (has_balance / game select
// etc.), create a "bridge" select step in sloten-main. The messages-native
// handler sets flow_state to this bridge step after the bonus match. When the
// user clicks a button, the flow engine picks up at the bridge and routes to
// the correct next step.
//
// Also adds missing steps for arquel/seraphim game targets and lucifire plans.
//
// Usage: node scripts/fix-bonus-flow-bridge.mjs

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const TMP_SQL = 'seeds/_fix-bonus-bridge.sql';

// 1. Fetch current steps + bonus_codes with items
console.log('Fetching data...');
const flowRaw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT id, steps FROM bot_flows WHERE name='sloten-main'"`,
  { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 },
).toString();
const flowRow = JSON.parse(flowRaw)[0].results[0];
const FLOW_ID = flowRow.id;
const steps = JSON.parse(flowRow.steps);
const stepsById = new Map(steps.map(s => [s.id, s]));

const bcRaw = execSync(
  `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT type_key, success_items FROM bonus_codes WHERE enabled=1 AND success_items IS NOT NULL AND success_items != '' AND success_items != '[]'"`,
  { stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 },
).toString();
const bonusCodes = JSON.parse(bcRaw)[0].results || [];

// 2. Build bridge steps + missing target steps
const newSteps = [];
const bridgeKeys = []; // type_keys that got a bridge step

// Game list for arquel/seraphim (ported from production bonus-codes.js GAME_LIST)
const GAME_LIST = {
  'gates_olympus_og': 'Gates of Olympus',
  'starlight': 'Starlight Princess',
  'starlight_xmas': 'Starlight Princess Christmas',
  'wisdom': 'Wisdom of Athena',
  'gates_olympus': 'Gates of Olympus 1000',
  'gatokaca': 'Gates of Gatokaca 1000',
  'sugar_rush_1000': 'Sugar Rush 1000',
  'sweet_bonanza': 'Sweet Bonanza 1000',
  'sugar_rush': 'Sugar Rush',
  'fruit_party': 'Fruit Party',
};

for (const bc of bonusCodes) {
  let items;
  try { items = JSON.parse(bc.success_items); } catch { continue; }
  if (!Array.isArray(items) || !items.length) continue;

  // Skip codes whose items only contain welcome_message / transfer_to_agent
  // (those already work without a bridge).
  const nonTrivial = items.filter(it =>
    it.value && it.value !== 'welcome_message' && it.value !== 'transfer_to_agent'
    && !/[↩⇔↔]/.test(it.title || ''));
  if (!nonTrivial.length) continue;

  const bridgeId = `bonus_select_${bc.type_key}`;
  // Remove existing bridge if re-running (idempotent).
  const existing = steps.findIndex(s => s.id === bridgeId);
  if (existing !== -1) steps.splice(existing, 1);

  // Build options with proper `next` pointers.
  const options = items.map(it => {
    let next = it.value;
    // Game selections: arquel_game_* → arquel_game_selected
    // seraphim_game_* → seraphim_game_selected
    // stepup_game_* → stepup_game_selected etc.
    const gamePrefixes = ['stepup_game_','vamos_game_','akeome_game_','special_chance_game_',
                          'tokubetsu_step_game_','tokubetsu_heavens_game_','arquel_game_','seraphim_game_',
                          'to_challenge_rengeki_game_','to_challenge_ichigeki_game_'];
    for (const prefix of gamePrefixes) {
      if (next && next.startsWith(prefix)) {
        const selectedStep = prefix.replace('_game_', '_game_selected');
        next = selectedStep;
        break;
      }
    }
    // lucifire plans: 入学10000 / 入学20000 → lucifire_plan_success
    if (next === '入学10000' || next === '入学20000') {
      next = 'lucifire_plan_success';
    }
    const isBack = /[↩⇔↔]/.test(it.title || '') || it.value === 'welcome_message';
    const isAgent = it.value === 'transfer_to_agent';
    return {
      title: it.title || '',
      value: it.value || '',
      next: next || null,
      ...(isBack || isAgent ? { skip_var: true } : {}),
    };
  });

  const bridgeStep = {
    id: bridgeId,
    type: 'select',
    prompt: '', // empty — the success message was already shown by the bonus handler
    var: '_bonus_choice',
    options,
  };
  newSteps.push(bridgeStep);
  bridgeKeys.push(bc.type_key);
  console.log(`  bridge: ${bridgeId} (${options.length} options)`);
}

// 3. Add missing game target steps (if not already present).
// For arquel/seraphim, individual game values don't exist as steps. We don't
// need them because the bridge step routes all games to *_game_selected. But
// verify the *_game_selected steps exist.
//
// CUSTOM_SELECTED_CONTENT overrides the generic "機種選択ありがとうございます"
// confirmation for promotions where we want to show full campaign details
// after the user picks a game (e.g. T/Oチャレンジ which has period, terms,
// and target-game disclaimer).
// Note: kept tight to fit D1's 100KB SQL statement limit. Full UTF-8 bytes
// (Japanese chars are 3 bytes each) add up fast across all bridge steps.
const CUSTOM_SELECTED_CONTENT = {
  to_challenge_rengeki_game_selected:
    '✅ ご参加ありがとうございます 😊\n\n'
    + '🎰 選択機種: {{vars._bonus_choice_title}}\n\n'
    + '📅 4/27(月)〜5/3(日) 23:59\n'
    + '🔗 https://slotenpromotion.com/rengeki-or-ichigeki/\n\n'
    + '⚠️ 注意事項\n'
    + '・コード送信後からベット額が集計対象になります。\n'
    + '・コード「連打」と機種は後から変更できません。\n'
    + '・対象機種は予告なく変更される場合があります。\n'
    + '・FSは5/4(月) 12:00から順次付与、賭け条件1倍、有効期限7日。\n\n'
    + '🎰 低額×多回数でコツコツ積み上げよう！',
  to_challenge_ichigeki_game_selected:
    '✅ ご参加ありがとうございます 😊\n\n'
    + '🎰 選択機種: {{vars._bonus_choice_title}}\n\n'
    + '📅 4/27(月)〜5/3(日) 23:59\n'
    + '🔗 https://slotenpromotion.com/rengeki-or-ichigeki/\n\n'
    + '⚠️ 注意事項\n'
    + '・コード送信後からベット額が集計対象になります。\n'
    + '・コード「一撃」と機種は後から変更できません。\n'
    + '・対象機種は予告なく変更される場合があります。\n'
    + '・FSは5/4(月) 12:00から順次付与、賭け条件1倍、有効期限7日。\n\n'
    + '🎰 高額×少回数で一発逆転を狙おう！',
};

for (const prefix of ['arquel', 'seraphim', 'stepup', 'vamos', 'akeome',
                       'special_chance', 'tokubetsu_step', 'tokubetsu_heavens',
                       'to_challenge_rengeki', 'to_challenge_ichigeki']) {
  const selectedId = `${prefix}_game_selected`;
  if (!stepsById.has(selectedId)) {
    console.log(`  adding missing step: ${selectedId}`);
    newSteps.push({
      id: selectedId,
      type: 'message',
      content: CUSTOM_SELECTED_CONTENT[selectedId]
        || `✅ 機種選択ありがとうございます！\n\n🎰 選択機種: {{vars._bonus_choice}}\n\n担当スタッフがこの後の\n参加手順をご案内いたします。\n\n少々お待ちください✨`,
      next: null,
    });
  }
}

// Ensure lucifire_plan_success exists.
if (!stepsById.has('lucifire_plan_success')) {
  console.log('  adding missing step: lucifire_plan_success');
  newSteps.push({
    id: 'lucifire_plan_success',
    type: 'message',
    content: '✅ プランコードを受け付けました！\n\nご入金が確認でき次第、キャッシュバック対象としてエントリーが完了します。\n\n担当スタッフが確認後、ご案内いたします。\n少々お待ちください✨',
    next: null,
  });
}

// 4. Merge new steps into the existing array (remove duplicates first).
const newIds = new Set(newSteps.map(s => s.id));
const filtered = steps.filter(s => !newIds.has(s.id));
const merged = [...filtered, ...newSteps];
console.log(`Steps: ${steps.length} → ${merged.length} (added ${newSteps.length}, removed ${steps.length - filtered.length} dupes)`);

// 5. Write SQL + apply.
const esc = s => String(s).replace(/'/g, "''");
const stepsJson = JSON.stringify(merged);
console.log(`Steps JSON size: ${stepsJson.length} bytes (${(stepsJson.length / 1024).toFixed(1)} KB)`);
const sql = `UPDATE bot_flows SET steps='${esc(stepsJson)}', updated_at=datetime('now') WHERE id=${FLOW_ID};`;
writeFileSync(TMP_SQL, sql);
const utf8Bytes = Buffer.byteLength(sql, 'utf8');
console.log(`SQL file size: ${sql.length} chars / ${utf8Bytes} UTF-8 bytes`);
if (utf8Bytes >= 100_000) {
  console.warn(`⚠️  Approaching D1 100KB SQL statement limit (currently ${utf8Bytes} bytes). Trim CUSTOM_SELECTED_CONTENT or split the update.`);
}
try {
  console.log('Applying to D1...');
  execSync(`npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP_SQL}`, { stdio: 'inherit', maxBuffer: 20 * 1024 * 1024 });
  console.log(`\nBridge keys: ${bridgeKeys.join(', ')}`);
  console.log('OK');
} finally {
  try { unlinkSync(TMP_SQL); } catch (_) {}
}
