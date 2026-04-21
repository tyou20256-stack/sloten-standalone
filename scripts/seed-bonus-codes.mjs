#!/usr/bin/env node
// Seed the 24 hardcoded bonus code types from production into D1.
// Reads seeds/_bonus-success-raw.json (extracted from messages.js).
//
// Usage: node scripts/seed-bonus-codes.mjs

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const TMP_SQL = 'seeds/_seed-bonus-codes.sql';
const RAW = JSON.parse(readFileSync('seeds/_bonus-success-raw.json', 'utf8'));

// Mirror HARDCODED_MAP from production bonus-codes.js. Order matters — higher
// priority is matched first. valid_bonus is deliberately omitted (production
// had it empty; re-add via admin UI if needed).
const DEFS = [
  // type_key,        display_name,             codes,                                                     match_mode,            success_key,               gas_type,     transfer_after
  ['vamos',            'バモスイボナ(Heaven\'s Shot)',   ['バモスイボナ','ばもすいぼな'],                                 'exact',               'vamos_bonus_success',      null,         false],
  ['akeome',           'あけおめ(Heaven\'s Shot)',        ['あけおめ','アケオメ'],                                         'exact',               'akeome_bonus_success',     null,         false],
  ['special_chance',   'スペシャルチャンス(ステップアップSTEP1)',     ['スペシャルチャンス','すぺしゃるちゃんす'],                           'exact',               'special_chance_success',   null,         false],
  ['tokubetsu_step',   '特別ステップ(ステップアップ)',     ['特別ステップ','とくべつすてっぷ'],                                 'exact',               'tokubetsu_step_success',   null,         false],
  ['tokubetsu_heavens','特別ヘブンズ(Heaven\'s Shot)',     ['特別ヘブンズ','とくべつへぶんず'],                                 'exact',               'tokubetsu_heavens_success',null,         false],
  ['custom_heavens',   'カスタムヘブンズショット',           ['カスタムヘブンズショット','カスタムヘブンズ','かすたむへぶんずしょっと'],         'exact',               'custom_heavens_success',   null,         false],
  ['triathlon',        'トライアスロン',                 ['トライアスロン','とらいあすろん'],                                 'case_insensitive',    'triathlon_success',        null,         false],
  ['hinamatsuri',      'ひな祭り',                       ['ひな祭り','ひなまつり','ヒナマツリ'],                               'case_insensitive',    'hinamatsuri_success',      null,         false],
  ['heavens_mission',  'ヘブンズミッション',               ['ヘブンズミッション','へぶんずみっしょん'],                           'case_insensitive',    'heavens_mission_success',  null,         false],
  ['heavens_win',      'ヘブンズウィン',                 ['ヘブンズウィン','へぶんずうぃん'],                                 'case_insensitive',    'heavens_win_success',      null,         false],
  ['elite_challenge',  'ELITEチャレンジ',                 ['ELITE参加','elite参加','Elite参加'],                              'case_insensitive',    'elite_challenge_success',  null,         false],
  ['white_day',        'ホワイトデー',                   ['ホワイトデー','ほわいとでー'],                                     'case_insensitive',    'white_day_success',        null,         false],
  ['stepup',           'スペシャルステップ(ステップアップ)',          ['スペシャルステップ'],                                             'exact',               'stepup_success',           null,         false],
  ['zorome',           'ゾロ目チャレンジ',               ['ゾロ目チャレンジ','ぞろめちゃれんじ'],                               'case_insensitive',    'zorome_success',           null,         false],
  ['suroten_dream',    'スロ天ドリーム',                 ['スロ天ドリーム','すろてんどりーむ'],                                 'case_insensitive',    'suroten_dream_success',    'BC_ギルド', false],
  // BC_入学 event codes
  ['gatorian',         'ゲートリアン',                   ['ゲートリアン','げーとりあん'],                                     'case_insensitive',    'gatorian_success',         'BC_入学',   false],
  ['riricia',          'リリシア',                       ['リリシア','りりしあ'],                                             'case_insensitive',    'riricia_success',          'BC_入学',   false],
  ['lucifire',         'ルシフィーレ',                   ['ルシフィーレ','るしふぃーれ'],                                     'case_insensitive',    'lucifire_success',         'BC_入学',   false],
  ['lucifire_plan',    'ルシフィーレ プラン申込',           ['入学10000','入学20000'],                                           'exact',               'lucifire_plan_success',    'BC_入学',   true],
  ['harpina',          'ハルピナ',                       ['ハルピナ','はるぴな'],                                             'case_insensitive',    'harpina_success',          'BC_入学',   false],
  ['arquel',           'アークエル',                     ['アークエル','あーくえる'],                                         'case_insensitive',    'arquel_success',           'BC_入学',   false],
  ['rafiel',           'ラフィエル',                     ['ラフィエル','らふぃえる'],                                         'case_insensitive',    'rafiel_success',           'BC_入学',   false],
  ['seraphim',         'セレフィム',                     ['セレフィム','せれふぃむ'],                                         'case_insensitive',    'seraphim_success',         'BC_入学',   false],
  // BC_だっちゃん event (HEAVEN DAY 特別プロモーション)
  ['heavenday_daachin','HEAVEN DAY だっちゃん天国',        ['だっちゃん天国'],                                                   'case_insensitive',    'heavenday_daachin_success','BC_だっちゃん', false],
];

const escSql = (s) => String(s == null ? '' : s).replace(/'/g, "''");
const lines = [];
// Idempotent: wipe hardcoded rows then re-insert. Dynamic (admin-added) rows
// are preserved via the WHERE filter.
lines.push(`DELETE FROM bonus_codes WHERE tenant_id='tenant_default' AND source='hardcoded';`);

let priority = 100;
for (const [type_key, display_name, codes, match_mode, success_key, gas_type, transfer_after] of DEFS) {
  const success = RAW[success_key];
  if (!success) {
    console.warn(`Missing success message for ${success_key}, skipping`);
    continue;
  }
  const codesJson = JSON.stringify(codes);
  const itemsJson = (success.items || []).length ? JSON.stringify(success.items) : null;
  lines.push(
    `INSERT INTO bonus_codes (tenant_id, type_key, display_name, codes, match_mode, success_content, success_items, gas_type, transfer_after, enabled, source, priority) VALUES ('tenant_default','${escSql(type_key)}','${escSql(display_name)}','${escSql(codesJson)}','${escSql(match_mode)}','${escSql(success.content)}',${itemsJson ? `'${escSql(itemsJson)}'` : 'NULL'},${gas_type ? `'${escSql(gas_type)}'` : 'NULL'},${transfer_after ? 1 : 0},1,'hardcoded',${priority});`,
  );
  priority -= 1; // preserve declaration order
}

writeFileSync(TMP_SQL, lines.join('\n'));
try {
  console.log(`Applying ${DEFS.length} bonus code seeds to ${DB} (remote)...`);
  execSync(
    `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP_SQL}`,
    { stdio: 'inherit', maxBuffer: 20 * 1024 * 1024 },
  );
  console.log('OK');
} finally {
  try { unlinkSync(TMP_SQL); } catch (_) {}
}
