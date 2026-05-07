// Menu tree extractor for bot_flows.
//
// Walks a flow's `select` steps from the start step and renders a compact
// indented bullet list that the AI can use to suggest deep navigation
// (`<jump-to>step_id</jump-to>`) when responding to free-form questions.
//
// Returns:
//   { text, validIds }
//   - text:     bullet-formatted tree, ready to inject into a system prompt
//   - validIds: Set of select step IDs the AI is allowed to jump to. Used by
//               the caller to reject hallucinated step IDs.

const BACK_TITLE_RE = /(戻る|↩|↩️|back to)/i;
const SKIP_VALUES = new Set(['transfer_to_agent']);

function isSkippableOption(opt) {
  if (!opt) return true;
  const title = String(opt.title || '');
  const value = String(opt.value || '');
  if (BACK_TITLE_RE.test(title)) return true;
  if (SKIP_VALUES.has(value)) return true;
  return false;
}

function trimPrompt(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function buildMenuTreeText(steps, startStepId, options = {}) {
  if (!Array.isArray(steps) || !steps.length) return { text: '', validIds: new Set() };
  const stepMap = new Map();
  for (const s of steps) if (s && s.id) stepMap.set(s.id, s);
  const startStep = stepMap.get(startStepId);
  if (!startStep || startStep.type !== 'select') return { text: '', validIds: new Set() };

  const maxDepth = options.maxDepth ?? 4;
  const lines = [];
  const validIds = new Set();
  const visited = new Set();

  function walk(stepId, depth) {
    if (depth > maxDepth) return;
    if (visited.has(stepId)) return;
    const step = stepMap.get(stepId);
    if (!step || step.type !== 'select') return;
    visited.add(stepId);
    const indent = '  '.repeat(depth);
    for (const opt of step.options || []) {
      if (isSkippableOption(opt)) continue;
      const idPart = opt.next ? `[${opt.next}]` : '[末端]';
      const titleText = String(opt.title || '').trim();
      lines.push(`${indent}- ${idPart} ${titleText}`);
      if (opt.next) {
        const next = stepMap.get(opt.next);
        if (next && next.type === 'select') {
          validIds.add(opt.next);
          walk(opt.next, depth + 1);
        }
      }
    }
    visited.delete(stepId);
  }

  validIds.add(startStep.id);
  lines.push(`- [${startStep.id}] ${trimPrompt(startStep.prompt) || 'メインメニュー'}`);
  walk(startStepId, 1);

  return { text: lines.join('\n'), validIds };
}

// Deterministic keyword → step_id mapping for menu navigation.
//
// Gemini Flash Lite is unreliable at picking the correct deep menu via prompt
// instructions, so we do navigation in JS. Order matters — earlier rules win
// when multiple keywords appear (e.g. "入金が反映されない" → trouble before
// deposit). All targets are validated against the caller's `validIds` set so a
// stale rule referencing a removed step ID is silently dropped.
//
// Rule shape: { kws: string[], target: string }. A rule fires when ANY keyword
// is a substring of the lowercased message. Single-character keywords are
// avoided to prevent false positives. Adjust by adding new rules — keep the
// most specific rules first.

// IMPORTANT — rule ordering: more specific rules MUST precede catch-alls.
// "入金不要ボーナス" must fire before "入金" catch-all, otherwise the latter
// would always win for any string containing the substring "入金".
//
// Also: many leaf method steps in the sloten-main flow (paypay_money,
// bank_transfer, atm_deposit, etc.) are `type: webhook` rather than `select`,
// so they're not in validIds and can't be jumped to. We map those keywords
// to the parent `deposit_methods` menu where the user can pick a method.
const NAV_RULES = [
  // Trouble first — "入金が反映されない" / "出金が届かない" must beat
  // generic "入金" / "出金".
  { kws: ['反映されない', '反映され ない', '届かない', 'キャンセル', 'トラブル', '入金がこない', '入金が来ない', '入金されない'], target: 'payment_troubleshooting' },

  // Bonus types — these contain "入金不要" / "ボーナス" substrings and must
  // be matched before the generic 入金 / ボーナス catch-alls below.
  { kws: ['入金不要ボーナス', '入金不要', '無料ボーナス', 'no deposit'], target: 'no_deposit_bonus' },
  { kws: ['ボーナスコード', 'ボーナス コード', 'クーポン', 'コードを使い', 'コード入力'], target: 'bonus_code_request' },
  { kws: ['ヘブンズウィン', 'ヘブンズ ウィン'], target: 'bonus_promo' },
  { kws: ['ステップアップ', 'heavens step', 'ヘブンズステップ'], target: 'heavens_stepup' },
  { kws: ['ボーナスの使い方', 'ボーナス使い方'], target: 'faq_bonus_usage' },

  // Account — specific first.
  { kws: ['ログインできない', 'ログイン できない', 'ログイン不可', 'パスワード忘れ', 'パスワードを忘れ'], target: 'login_issues' },
  { kws: ['パスワード変更', 'パスワード リセット', 'パスワードリセット'], target: 'password_change' },
  { kws: ['メールアドレス変更', 'メール変更', 'メアド変更'], target: 'email_change' },
  { kws: ['電話番号変更', '携帯番号変更'], target: 'phone_change' },
  { kws: ['ログイン'], target: 'login_issues' },
  { kws: ['パスワード'], target: 'password_change' },
  { kws: ['退会', '凍結'], target: 'account_issues' },

  // Game — specific first.
  { kws: ['ゲームの種類', 'ゲーム種類', 'スロット種類'], target: 'game_types' },
  { kws: ['ゲームの不具合', 'ゲーム不具合', 'ゲームエラー', 'ゲームができない'], target: 'game_issues' },
  { kws: ['対応デバイス', 'スマホ対応', 'iphone', 'android'], target: 'supported_devices' },

  // FAQ leaves.
  { kws: ['kyc', '本人確認'], target: 'faq_kyc' },
  { kws: ['処理時間', '入出金の時間', '入金時間'], target: 'faq_processing_time' },
  { kws: ['決済方法', '対応している決済'], target: 'faq_payment_methods' },

  // Cryptocurrency is a real select with children — direct jump.
  { kws: ['仮想通貨', 'ビットコイン', 'bitcoin', 'btc', 'ethereum', 'eth', 'usdt', '暗号資産'], target: 'cryptocurrency' },

  // Withdrawal — must come before 入金 catch-all (出 vs 入 don't overlap,
  // but defensive ordering for combined queries like "入金と出金の違い").
  { kws: ['出金', '引き出し', '引出し', 'withdrawal', 'お金を引き', '振込時間', '出金時間'], target: 'withdrawal_methods' },

  // Deposit — individual method names route to deposit_methods menu since
  // their dedicated steps are webhooks (not jumpable selects).
  { kws: ['paypayマネー', 'ペイペイマネー', 'paypay', 'ペイペイ'], target: 'deposit_methods' },
  { kws: ['銀行振込', '銀行 振込', 'ぎんこう振込'], target: 'deposit_methods' },
  { kws: ['コンビニ入金', 'コンビニ'], target: 'deposit_methods' },
  { kws: ['atm入金', 'atm'], target: 'deposit_methods' },
  { kws: ['入金方法', '入金 方法', '入金したい', '入金できる', '入金やり方', '振り込みたい', '振り込み方法', 'デポジット', 'チャージ'], target: 'deposit_methods' },
  { kws: ['入金'], target: 'deposit_methods' }, // catch-all

  // Promo — generic, lower priority than bonus rules above.
  { kws: ['プロモ', 'promotion', 'キャンペーン', 'イベント'], target: 'bonus_promo' },

  // Game catch-all.
  { kws: ['ゲーム', '不具合'], target: 'game_info' },

  // Account catch-all (last resort for account-related questions).
  { kws: ['アカウント'], target: 'account_issues' },

  // Generic FAQ catch-all — only matches "faq" / "よくある質問".
  { kws: ['よくある質問', 'faq'], target: 'faq_main' },
];

/**
 * Infer the best step_id to jump to for the given customer message.
 * Returns null if no rule matches or the matched target isn't in validIds.
 *
 * @param {string} message — raw customer message
 * @param {Set<string>} validIds — step IDs allowed for jump (from buildMenuTreeText)
 * @param {string} [currentStepId] — current step; we won't jump to it (no-op)
 * @returns {string|null}
 */
export function inferJumpTarget(message, validIds, currentStepId, opts = {}) {
  if (!message || typeof message !== 'string') return null;
  // Suppress jump when the user's intent is an announcements / period
  // question. Without this, queries like "GW期間中の入出金について教えて"
  // fall into the 出金 keyword rule (because 入出金 contains 出金) and the
  // user is jumped to withdrawal_methods instead of getting the
  // announcements RAG answer.
  //
  // Caller passes detectAnnouncementQuery so we don't duplicate the regex
  // patterns here — single source of truth lives in announcements.mjs.
  // Falls back to no suppression if the detector wasn't passed.
  if (opts.detectAnnouncement && opts.detectAnnouncement(message)) return null;
  const lower = message.toLowerCase();
  for (const rule of NAV_RULES) {
    for (const kw of rule.kws) {
      if (lower.includes(kw.toLowerCase())) {
        if (rule.target === currentStepId) return null; // self-jump skip
        if (validIds && !validIds.has(rule.target)) continue; // target absent
        return rule.target;
      }
    }
  }
  return null;
}

