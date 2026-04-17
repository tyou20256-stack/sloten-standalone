#!/usr/bin/env node
// Replace the single-shot GAS webhook steps (paypay_money / paypay_money_lite /
// bank_transfer) inside the main flow with multi-step deposit sub-flows that:
//   1) confirm the method,
//   2) ask account/name,
//   3) ask amount,
//   4) ask for screenshot (attachment),
//   5) POST one complete record to GAS,
//   6) confirm done.
//
// The GAS spreadsheet row is therefore written only ONCE per customer, at the
// final submit — matching the production expectation.
//
// Usage: node scripts/fix-deposit-flows.mjs

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const WRANGLER = 'npx wrangler';
const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const FLOW_NAME = 'sloten-main';
const TMP_JSON = 'seeds/_current-flow.json';
const TMP_SQL = 'seeds/_fix-deposit-flows.sql';

// Shared: sloten-tenngoku account ID (username). Examples from production:
//   sy2525m, river363, hitomu → lowercase alphanum, 3-20 chars.
const ACCOUNT_ID_SLOT = {
  var: 'account_id',
  match: { regex: '^[A-Za-z0-9_-]{3,20}$' },
  prompt: 'スロット天国の**アカウントID（ユーザー名）**を入力してください。\n例: sy2525m, river363, hitomu',
  confirm: '✅ アカウントID「{{vars.account_id}}」を受け付けました。',
};

const SCREENSHOT_SLOT = {
  var: 'screenshot_attachment_id',
  match: { attachment: true },
  prompt: '入金完了画面のスクリーンショットを添付してください。\n（左下の 📎 アイコンから画像を選択）',
  confirm: '✅ スクリーンショットを受け付けました。',
};

function depositSteps({ key, method, paymentMethodLabel, introContent, kind }) {
  // kind: 'paypay' | 'bank' | 'ec'
  const submit = `${key}_submit`;
  const done = `${key}_done`;
  const err = `${key}_error`;

  // Amount slot configured per method.
  let amountSlot;
  if (kind === 'paypay') {
    amountSlot = {
      var: 'amount',
      match: { regex: '^[0-9]{3,7}$' },
      min_numeric: 3000,
      max_numeric: 300000,
      range_error: 'PayPay入金は **3,000円〜300,000円** の範囲のみ対応しています。\n再度金額をご入力ください。',
      prompt: '入金希望額を半角数字で入力してください。（3,000〜300,000円）',
      confirm: '✅ 金額 {{vars.amount}}円 を受け付けました。',
    };
  } else if (kind === 'bank') {
    amountSlot = {
      var: 'amount',
      match: { regex: '^[0-9]{3,7}$' },
      min_numeric: 10000,
      max_numeric: 50000,
      range_error:
        '銀行振込（手動）の対応範囲は **10,000円〜50,000円** です。\n\n'
        + '**50,000円を超えるご入金は、サイトの入金ページから「銀行（自動）」でご申請ください。**\n\n'
        + 'この窓口では手動の範囲内のみ対応しています。金額を修正するか、サイトの入金ページをご利用ください。',
      prompt: '入金希望額を半角数字で入力してください。（10,000〜50,000円、それ以上は銀行(自動)をご利用ください）',
      confirm: '✅ 金額 {{vars.amount}}円 を受け付けました。',
    };
  } else {
    // ec / other: no strict range, just sanity check
    amountSlot = {
      var: 'amount',
      match: { regex: '^[0-9]{3,7}$' },
      min_numeric: 3000,
      max_numeric: 300000,
      range_error: 'コンビニ入金は 3,000円〜300,000円 の範囲でご入力ください。',
      prompt: '入金希望額を半角数字で入力してください。（3,000〜300,000円）',
      confirm: '✅ 金額 {{vars.amount}}円 を受け付けました。',
    };
  }

  // PayPay keeps transaction_id; bank/ec do not.
  const slots = [ACCOUNT_ID_SLOT, amountSlot];
  if (kind === 'paypay') {
    // Production PayPay transaction numbers are 20 digits (example: 02246825413292220418).
    // Accept 19-21 digits to allow ±1 character difference per spec.
    slots.push({
      var: 'transaction_id',
      match: { regex: '^[0-9]{19,21}$' },
      prompt: 'PayPay取引番号を入力してください。\n（完了画面またはメールに記載の **20桁の数字**、例: 02246825413292220418）',
      confirm: '✅ 取引番号「{{vars.transaction_id}}」を受け付けました。',
    });
  }
  slots.push(SCREENSHOT_SLOT);

  const fieldList = slots
    .map((s) => {
      if (s === ACCOUNT_ID_SLOT) return '・スロット天国のアカウントID（ユーザー名）';
      if (s.var === 'amount') return kind === 'bank'
        ? '・入金金額（10,000〜50,000円）'
        : kind === 'paypay'
          ? '・入金金額（3,000〜300,000円）'
          : '・入金金額';
      if (s.var === 'transaction_id') return '・PayPay取引番号';
      if (s.var === 'screenshot_attachment_id') return '・入金完了画面のスクリーンショット';
      return '・' + s.var;
    })
    .join('\n');

  const introForCollect = introContent
    + '\n\n下記の情報をすべてお知らせください（順番は自由です）:\n'
    + fieldList;

  const submitBody = kind === 'paypay'
    ? {
        event: 'deposit_submit',
        method,
        payment_method: paymentMethodLabel,
        account_id: '{{vars.account_id}}',
        amount: '{{vars.amount}}',
        transaction_id: '{{vars.transaction_id}}',
      }
    : {
        event: 'deposit_submit',
        method,
        payment_method: paymentMethodLabel,
        account_id: '{{vars.account_id}}',
        amount: '{{vars.amount}}',
      };

  return [
    {
      id: key,
      type: 'collect',
      intro: introForCollect,
      slots,
      on_invalid: '⚠️ 入力内容の形式が正しくないようです。以下の形式で再度お送りください。',
      next: submit,
    },
    {
      id: submit,
      type: 'webhook',
      url: '{{env.GAS_BOT_WEBHOOK_URL}}',
      method: 'POST',
      timeout_ms: 10000,
      body: submitBody,
      on_error: err,
      error_message: '記録に失敗しました。担当者におつなぎします。',
      next: done,
    },
    {
      id: done,
      // Completion message mirrors the production EC-style acknowledgement so
      // the UX is consistent across all deposit methods.
      type: 'message',
      content: kind === 'paypay'
        ? '✅ **入金申請受付完了**\n\n💰 **金額**: ¥{{vars.amount}}\n🆔 **アカウント**: {{vars.account_id}}\n🔢 **取引番号**: {{vars.transaction_id}}\n\n担当スタッフが確認後、ご案内いたします。\n少々お待ちください✨'
        : '✅ **入金申請受付完了**\n\n💰 **金額**: ¥{{vars.amount}}\n🆔 **アカウント**: {{vars.account_id}}\n\n担当スタッフが確認後、ご案内いたします。\n少々お待ちください✨',
      next: null,
    },
    {
      id: err,
      type: 'handoff',
      note: `${paymentMethodLabel}入金フロー: GAS連携失敗。担当者確認要。`,
    },
  ];
}

// Intro text — EXACT match with production messages.js paypay_money /
// paypay_money_lite / bank_transfer so the UX is identical to AgentBot.
const paypayMoneyIntro =
  '🏦 PayPayマネーでの入金ですね。\n\nこれより自動案内を開始いたします。\n少々お待ちください。';
const paypayMoneyLiteIntro =
  '🏦 PayPayマネーライトでの入金ですね。\n\nこれより自動案内を開始いたします。\n少々お待ちください。';
const bankTransferIntro =
  '🏦 銀行振込での入金ですね。\n\nこれより自動案内を開始いたします。\n少々お待ちください。';

const paypayMoneySteps = depositSteps({
  key: 'paypay_money',
  method: 'paypay',
  paymentMethodLabel: 'マネー',
  introContent: paypayMoneyIntro,
  kind: 'paypay',
});
const paypayMoneyLiteSteps = depositSteps({
  key: 'paypay_money_lite',
  method: 'paypay',
  paymentMethodLabel: 'マネーライト',
  introContent: paypayMoneyLiteIntro,
  kind: 'paypay',
});
const bankTransferSteps = depositSteps({
  key: 'bank_transfer',
  method: 'bank',
  paymentMethodLabel: '銀行振込',
  introContent: bankTransferIntro,
  kind: 'bank',
});

// EC (convenience store) flow — EXACT match with production worker.js state
// machine (see chatwoot-final-working/worker.js §4.5 EC入金フロー).
//   1) account_id: 英数字 3〜20 validation
//   2) amount_range select: ¥10k-¥100k | ¥110k-¥200k | cancel
//   3) amount select: 10 buttons per range, each value = JP yen integer
//   4) submit to EC webhook (EC_DEPOSIT_BOT_WEBHOOK_URL)
//   5) 決済番号発行中... message (VPS posts back separately; out of scope for
//      standalone unless an inbound webhook endpoint is added later)
function ecAmountOptions(start, end) {
  const opts = [];
  for (let v = start; v <= end; v += 10000) {
    opts.push({ title: `¥${v.toLocaleString('en-US')}`, value: String(v), next: 'convenience_store_deposit_submit' });
  }
  // Back button: skip_var so the literal step id doesn't overwrite vars.amount.
  opts.push({ title: '↩️ 戻る', value: 'convenience_store_deposit_amount_range', next: 'convenience_store_deposit_amount_range', skip_var: true });
  return opts;
}

const ecSteps = [
  {
    id: 'convenience_store_deposit',
    type: 'message',
    content: '🏪 コンビニでの入金ですね。\n\nまず、**スロット天国のアカウントID**（ユーザー名）を入力してください。\n\n例: sy2525m, river363, hitomu',
    next: 'convenience_store_deposit_ask_account',
  },
  {
    id: 'convenience_store_deposit_ask_account',
    type: 'input',
    prompt: 'スロット天国のアカウントID（ユーザー名）を入力してください。\n例: sy2525m, river363, hitomu',
    var: 'account_id',
    validate: '^[a-zA-Z0-9]{3,20}$',
    validate_error: '❌ アカウントIDは英数字3〜20文字で入力してください。\n\n例: sy2525m, river363, hitomu',
    next: 'convenience_store_deposit_amount_range',
  },
  {
    id: 'convenience_store_deposit_amount_range',
    type: 'select',
    prompt: '✅ アカウントID: **{{vars.account_id}}**\n\nご希望の入金額を選択してください。',
    var: '_range',
    options: [
      { title: '💰 ¥10,000 〜 ¥100,000', value: 'ec_amount_range_1', next: 'convenience_store_deposit_amount_range_1' },
      { title: '💰 ¥110,000 〜 ¥200,000', value: 'ec_amount_range_2', next: 'convenience_store_deposit_amount_range_2' },
      { title: '↩️ キャンセル', value: 'welcome_message', next: 'welcome_message' },
    ],
  },
  {
    id: 'convenience_store_deposit_amount_range_1',
    type: 'select',
    prompt: '💰 入金額を選択してください（¥10,000 〜 ¥100,000）',
    var: 'amount',
    options: ecAmountOptions(10000, 100000),
  },
  {
    id: 'convenience_store_deposit_amount_range_2',
    type: 'select',
    prompt: '💰 入金額を選択してください（¥110,000 〜 ¥200,000）',
    var: 'amount',
    options: ecAmountOptions(110000, 200000),
  },
  {
    id: 'convenience_store_deposit_submit',
    type: 'webhook',
    url: '{{env.EC_DEPOSIT_BOT_WEBHOOK_URL}}',
    method: 'POST',
    timeout_ms: 10000,
    body: {
      event: 'ec_deposit',
      action: 'ec_order',
      method: 'ec',
      payment_method: 'コンビニ入金',
      account_id: '{{vars.account_id}}',
      amount: '{{vars.amount}}',
    },
    on_error: 'convenience_store_deposit_error',
    error_message: '決済番号の発行でエラーが発生しました。担当者におつなぎします。',
    next: 'convenience_store_deposit_waiting',
  },
  {
    id: 'convenience_store_deposit_waiting',
    type: 'message',
    content: '✅ **入金申請受付完了**\n\n💰 **金額**: ¥{{vars.amount}}\n🆔 **アカウント**: {{vars.account_id}}\n\n⏳ **決済番号発行中...**\n約10分程度お時間をいただきます。\n発行完了次第、こちらのチャットにてお知らせいたします。',
    next: null,
  },
  {
    id: 'convenience_store_deposit_error',
    type: 'handoff',
    note: 'EC(コンビニ)入金フロー: 決済番号発行webhookが失敗。担当者確認要。',
  },
];

// Purge any step whose id is — or starts with — one of these prefixes. This
// makes the script fully idempotent across runs (including when we add or
// remove sub-steps within a deposit sub-flow).
const REMOVE_PREFIXES = ['paypay_money_lite', 'paypay_money', 'bank_transfer', 'convenience_store_deposit'];
function shouldRemove(id) {
  return REMOVE_PREFIXES.some((p) => id === p || id.startsWith(p + '_') || id === `${p}__menu` || id === `${p}__handoff_fallback`);
}

// Pull current flow steps from D1 remote.
console.log(`Fetching current ${FLOW_NAME} flow...`);
const rawOut = execSync(
  `${WRANGLER} d1 execute ${DB} --config ${CONFIG} --remote --json --command "SELECT id, steps FROM bot_flows WHERE name='${FLOW_NAME}' LIMIT 1"`,
  { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 },
).toString();

const parsed = JSON.parse(rawOut);
const row = parsed[0]?.results?.[0];
if (!row) {
  console.error('Flow not found');
  process.exit(1);
}
const flowId = row.id;
const currentSteps = JSON.parse(row.steps);
console.log(`Loaded flow id=${flowId} with ${currentSteps.length} steps`);

const filtered = currentSteps.filter((s) => !shouldRemove(s.id));
const removedCount = currentSteps.length - filtered.length;
console.log(`Removed ${removedCount} old deposit steps`);

const newSteps = [
  ...filtered,
  ...paypayMoneySteps,
  ...paypayMoneyLiteSteps,
  ...bankTransferSteps,
  ...ecSteps,
];
console.log(`New steps total: ${newSteps.length}`);

// Write new JSON via D1 parameterized execute (use a temp SQL file to handle size).
const stepsJson = JSON.stringify(newSteps);
const esc = (s) => s.replace(/'/g, "''");
const sql = `UPDATE bot_flows SET steps = '${esc(stepsJson)}', updated_at = datetime('now') WHERE id = ${flowId};`;

writeFileSync(TMP_SQL, sql);
try {
  console.log('Updating flow in D1...');
  const out = execSync(
    `${WRANGLER} d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP_SQL}`,
    { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 },
  );
  console.log(out.toString().split('\n').slice(-10).join('\n'));
  console.log('OK');
} finally {
  try { unlinkSync(TMP_SQL); } catch (_) {}
  try { unlinkSync(TMP_JSON); } catch (_) {}
}
