// src/escalation.mjs
// Customer message → escalation decision. Inspired by CS 20年 advisor
// recommendations (HANDOFF/ai-accuracy-discussion/07-support-responder.md):
//   Phase 1: hardKW 辞書 + RG (依存症) 検出 + 禁止ワード
//   Phase 2 (future): sentiment analysis + dead-loop detection
//
// Used by messages-native.mjs before the AI adapter runs. If escalation is
// decided, the customer gets a canned safe response and the conversation
// transitions to `open` (human operator takes over).

// 金銭トラブル / 本人確認 / 法的主張 / 未成年 / 退会 — AI では絶対に答えない
const HARD_ESCALATION_PATTERNS = [
  // Refund — both terse demands ("金返せ") and polite-but-urgent forms
  // ("5万円返してください今すぐ"). Caught: 返金, 金返せ, お金返, 全額返金,
  // <数字>円返(し|って), 返してください+(今すぐ|早く|すぐに)
  { re: /返金|金返せ|お金返|全額(?:返)?金|\d+\s*円.*返(?:し|って)|返(?:して|金して)(?:ください|くださ).*(?:今すぐ|すぐ|早く)|(?:今すぐ|早く|すぐに).*返(?:して|金)/, reason: 'money_refund' },
  { re: /出金(?:できない|されない|が反映|が遅い)/,                reason: 'withdrawal_issue' },
  { re: /入金(?:したのに|されない|反映され)/,                    reason: 'deposit_issue' },
  { re: /訴え|弁護士|消費者(?:センター|庁)|景表法|違法/,          reason: 'legal_claim' },
  { re: /(?:アカウント|口座)(?:凍結|ロック|停止)/,                reason: 'account_freeze' },
  { re: /本人確認(?:できない|通らない)|KYC(?:できない|落ち)/i,    reason: 'kyc_issue' },
  { re: /(?:未成年|18歳未満|子供が勝手に|息子が勝手に|娘が勝手に)/, reason: 'underage' },
  { re: /退会|削除(?:してください|したい)|アカウント(?:消|削除)/,  reason: 'account_deletion' },
  { re: /不正(?:アクセス|ログイン|利用)/,                         reason: 'unauthorized_access' },
  // Explicit human-operator request — must escalate, not deflect to menu
  { re: /(?:オペレーター|オペレータ|担当者|人[とに]|スタッフ).*(?:話|繋|つな|呼|お願い)|(?:話したい|繋いで|つないで|呼んで).*(?:オペレーター|オペレータ|担当者|人[とに]|スタッフ)/, reason: 'operator_request' },
];

// 依存症兆候 — Responsible Gambling (RG) 対応が必須
const RG_PATTERNS = [
  /(?:もう|全部|もう全部)(?:やめ|終わ|負け|失)/,
  /(?:ギャンブル|スロット|カジノ)(?:依存|中毒|やめたい)/,
  /借金(?:して|で|地獄|まみれ)/,
  /(?:生活費|家賃|食費)(?:まで|を)(?:使|注ぎ|溶か)/,
  /(?:死に|しにたい|消えたい|自殺)/,
  /(?:家族|嫁|旦那|親)(?:にバレ|に言え|にバレる)/,
];

// 怒り・不満 — AI 続行すると炎上、即エスカ
const ANGER_PATTERNS = [
  /ふざけ(?:んな|るな)|最悪|二度と使わない/,
  /詐欺(?:だろ|じゃ|です)/,
  /SNS(?:に書|で晒|で拡散)|Twitter(?:に書|で晒)|X(?:に書|で晒)/,
  /炎上(?:させ|させる)/,
  /(?:金|お金)(?:盗|ぬすま|盗まれ)/,
  // Frustration — repeated unresolved issue. AI continuing makes it worse.
  /(?:何[も度回])(?:.{0,10})(?:解決|対応|返事|連絡)し?(?:ない|てくれない)/,
  /(?:いつまで|何時間|何日)(?:.{0,15})(?:待たせ|放置|無視)/,
  /(?:対応|返事|連絡)(?:が悪い|遅い|されない|してくれない)/,
];

/**
 * Decide whether a customer message should bypass the AI and route directly
 * to a human operator. Returns { shouldEscalate, reason, responseText } when
 * escalation is required, or { shouldEscalate: false } when normal AI flow
 * should continue.
 *
 * History is optional; Phase 1 uses only current message content.
 */
export function decideEscalation(customerMessage, history = []) {
  const text = String(customerMessage || '');
  if (!text.trim()) return { shouldEscalate: false };

  // 1. Hard escalation — always bypass AI
  for (const { re, reason } of HARD_ESCALATION_PATTERNS) {
    if (re.test(text)) {
      return {
        shouldEscalate: true,
        reason: reason,
        category: 'hard',
        responseText:
          '大変恐れ入ります。お問い合わせ内容を確認のうえ、担当者よりご対応させていただきます。少々お待ちくださいませ。',
      };
    }
  }

  // 2. Responsible Gambling — fixed copy + contact info, never AI-generated
  for (const re of RG_PATTERNS) {
    if (re.test(text)) {
      return {
        shouldEscalate: true,
        reason: 'rg_support',
        category: 'rg',
        responseText: buildRgResponse(),
      };
    }
  }

  // 3. Anger keywords — avoid AI (risk of escalating with wrong tone)
  for (const re of ANGER_PATTERNS) {
    if (re.test(text)) {
      return {
        shouldEscalate: true,
        reason: 'anger',
        category: 'anger',
        responseText:
          'ご不快な思いをおかけしており、大変申し訳ございません。詳しい状況を担当者にて確認させていただきますので、少々お待ちくださいませ。',
      };
    }
  }

  // 4. Repeat-question / dead-loop detection (history-based, Phase 1 + Phase 2)
  //    Compare the CURRENT message against the 2 customer messages BEFORE it.
  //    The caller's history may already include the current message (e.g. if
  //    it was just inserted into DB before the escalation check) — we handle
  //    this by excluding any trailing entry whose content matches the current
  //    text exactly.
  if (history && history.length >= 2) {
    const customerAll = history
      .filter((m) => m.sender_type === 'customer')
      .map((m) => String(m.content || '').trim())
      .filter((s) => s.length > 0);
    // The current message may or may not be present in history (depends on
    // call site — messages-native.mjs:200 fetches customer-only history
    // BEFORE inserting the current customer msg, so the trailing entry is
    // the previous turn, not a copy of current). Take the last 2 entries
    // and compare against current. If both match the current text (or all 3
    // including a possible trailing copy match), it's a deadloop.
    //
    // Bug fix 2026-05-08: the previous strip-trailing-copy logic broke the
    // most common case (history WITHOUT current msg) — stripping reduced
    // the comparison set from 2 to 1 entries → no deadloop fired even on
    // 3-turn identical questions. Use occurrence count instead.
    const cur = text.trim();
    const last2 = customerAll.slice(-2);
    const last3 = customerAll.slice(-3);
    if (last2.length >= 2 && last2.every((c) => c === cur)) {
      return {
        shouldEscalate: true,
        reason: 'deadloop',
        category: 'deadloop',
        responseText:
          'お手数をおかけしております。スムーズにご案内できるよう、担当者にお繋ぎいたします。少々お待ちくださいませ。',
      };
    }
    // Insert-before-call pattern: current is the trailing entry, so the 2
    // entries BEFORE that should match for deadloop. last3 covers this.
    if (last3.length >= 3 && last3[2] === cur && last3[0] === cur && last3[1] === cur) {
      return {
        shouldEscalate: true,
        reason: 'deadloop',
        category: 'deadloop',
        responseText:
          'お手数をおかけしております。スムーズにご案内できるよう、担当者にお繋ぎいたします。少々お待ちくださいませ。',
      };
    }
    // For backward compatibility, derive customerPrev (used by similarity check)
    const customerPrev = customerAll[customerAll.length - 1] === cur
      ? customerAll.slice(0, -1)
      : customerAll;
    const prev = customerPrev.slice(-2);
    if (prev.length >= 2) {
      // Phase 2: similarity — current vs both previous
      //   (a) Both Jaccard ≥ 0.5, OR
      //   (b) A shared non-trivial content word (≥ 4 chars) appears in all 3.
      //       This captures CJK topic repetition where verb/particle variation
      //       drops bigram overlap below 0.5 but the subject is clearly the same.
      const sim1 = jaccard(text, prev[0]);
      const sim2 = jaccard(text, prev[1]);
      const sharedTopic = findSharedTopic([text, prev[0], prev[1]]);
      if ((sim1 >= 0.5 && sim2 >= 0.5) || sharedTopic) {
        return {
          shouldEscalate: true,
          reason: 'deadloop_full',
          category: 'deadloop',
          responseText:
            '同様のご質問が続いているようですので、お手数ですが担当者にお繋ぎいたします。少々お待ちくださいませ。',
        };
      }
    }
  }

  // 5. Negative sentiment (Phase 2 H) — lightweight dictionary-based
  //    scoring. Gets flagged when score ≤ -2 AND message length > 10 chars
  //    (short messages like "？" aren't evaluated).
  if (text.length > 10) {
    const sent = scoreSentiment(text);
    if (sent.score <= -2) {
      return {
        shouldEscalate: true,
        reason: 'negative_sentiment',
        category: 'anger',
        responseText:
          'ご意見ありがとうございます。お気持ちをしっかり受け止めて、担当者より改めてご対応させていただきます。少々お待ちくださいませ。',
      };
    }
  }

  return { shouldEscalate: false };
}

// --- Phase 2 helpers -------------------------------------------------------

// Character bigram Jaccard similarity (0..1). Cheap, CJK-friendly.
function bigrams(s) {
  const out = new Set();
  const normalized = s.replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i + 2 <= normalized.length; i++) out.add(normalized.slice(i, i + 2));
  return out;
}
function jaccard(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
// Find a non-trivial content word (≥ 4 chars) that appears in every text.
// Excludes common particles / stop-character sequences so "ください" etc. don't
// falsely signal topic repetition.
const STOP_SUBSTRINGS = [
  'ください', 'しました', 'ですが', 'ました', 'ですか', 'ですね',
  'ません', 'でした', 'いただき', 'ありがとう',
];
// Topic match requires CJK — avoids false-positive on button payloads like
// "deposit_withdrawal" / "atm_deposit" that share ASCII substrings but are
// not real repeated questions.
const CJK_RE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
function findSharedTopic(texts) {
  if (texts.length < 2) return null;
  const normalized = texts.map((t) => String(t || '').replace(/\s+/g, ''));
  const shortest = normalized.reduce((a, b) => (a.length < b.length ? a : b));
  for (let len = 6; len >= 4; len--) {
    for (let i = 0; i + len <= shortest.length; i++) {
      const sub = shortest.slice(i, i + len);
      if (STOP_SUBSTRINGS.some((s) => sub.includes(s))) continue;
      // Require Japanese content so ASCII-only button payloads don't match.
      if (!CJK_RE.test(sub)) continue;
      if (normalized.every((t) => t.includes(sub))) return sub;
    }
  }
  return null;
}

function pairwiseSimilarity(texts) {
  let total = 0, pairs = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      total += jaccard(texts[i], texts[j]);
      pairs++;
    }
  }
  return pairs ? total / pairs : 0;
}

// Japanese sentiment dictionary — lightweight, Phase 2.
// Not ML; catches obvious signals that ANGER_PATTERNS missed (e.g. mild frustration).
const SENTIMENT_NEG = [
  'ひどい', '最悪', '酷い', 'やばい', 'クソ', '糞', 'ムカつく', 'ムカムカ', 'イライラ',
  '不満', '不快', '無駄', 'まじで', 'マジで', 'なんで', 'なんでだ',
  'わけわからん', '意味不明', '使えない', '遅い', 'のろい',
  '信用できない', '信じられない', '残念', 'がっかり',
];
const SENTIMENT_POS = [
  'ありがとう', 'ありがとうございます', '助かり', '良い', 'いいね', '嬉しい',
  '感謝', 'すごい', '便利', '分かりやすい',
];

export function scoreSentiment(text) {
  const t = String(text || '');
  let score = 0;
  const hits = [];
  for (const w of SENTIMENT_NEG) {
    if (t.includes(w)) { score -= 1; hits.push('-' + w); }
  }
  for (const w of SENTIMENT_POS) {
    if (t.includes(w)) { score += 1; hits.push('+' + w); }
  }
  // Emphasis multipliers
  if (/！！+|!!+/.test(t)) score -= 1; // multiple exclamation marks
  if (/です[ねよ]？/.test(t)) score -= 0;
  return { score, hits };
}

/**
 * RG 相談窓口案内。電話番号・URL は env で上書き可能にしてあり、古い情報を
 * コード変更なしで更新できる。デフォルトは公開されている一般的な窓口情報。
 */
function buildRgResponse(env) {
  // Defaults — Verified public resources as of 2026-04. Operators should
  // confirm latest numbers periodically and override via env if changed.
  const helpline = (env && env.RG_HELPLINE_TEXT)
    || '・ギャンブル依存症問題を考える会: https://scga.jp/\n・厚生労働省 依存症対策: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000070789.html';
  return [
    'ご状況を拝見し、専門の相談窓口をご案内いたします。',
    '',
    helpline,
    '',
    'またご希望があれば、入金上限の設定やアカウント一時停止もサポート可能です。',
    '担当者にお繋ぎしますので、少々お待ちくださいませ。',
  ].join('\n');
}

// Export for testing
export const __TEST__ = { HARD_ESCALATION_PATTERNS, RG_PATTERNS, ANGER_PATTERNS };
