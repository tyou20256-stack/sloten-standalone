// src/responseFilter.mjs
// 禁止回答フィルタ — LLM出力のポストプロセッシング
// 9カテゴリの禁止パターンをコードレベルでブロック

export const PROHIBITED_CATEGORIES = [
  {
    category: 'other_player_info',
    patterns: [
      /(?:他の|別の|他人の)(?:プレイヤー|ユーザー|お客様)(?:の|は).{0,20}(?:残高|入金|出金|勝ち|負け|アカウント)/i,
    ],
    fallback: '申し訳ございません。他のお客様の情報についてはお答えできません。',
  },
  {
    category: 'internal_odds_rtp',
    patterns: [
      /(?:RTP|還元率|オッズ)(?:を|は).{0,20}(?:操作|変更|調整|コントロール)/i,
      /(?:遠隔|不正|イカサマ).{0,10}(?:ある|ない|して)/i,
    ],
    fallback: '全ゲームは独立した第三者機関により公正性が検証されています。RTPは各ゲームのヘルプ画面でご確認いただけます。',
  },
  {
    category: 'legal_advice',
    patterns: [
      /(?:合法|違法|適法|犯罪|法律違反)(?:です|でしょう|かどうか)/i,
      /(?:逮捕|起訴|罰金|懲役).{0,15}(?:される|ない|ある)/i,
    ],
    fallback: '法的なご質問については、専門の法律家にご相談されることをお勧めいたします。',
  },
  {
    category: 'gambling_advice',
    patterns: [
      /(?:このゲーム|このスロット)(?:は|なら).{0,15}(?:勝てる|稼げる|儲かる)/i,
      /(?:必勝|攻略|勝ち方|稼ぎ方)(?:法|術|テクニック)/i,
    ],
    fallback: 'ギャンブルの結果は完全にランダムであり、勝利を保証する方法はありません。責任あるギャンブルを心がけてください。',
  },
  {
    category: 'internal_business',
    patterns: [
      /(?:売上|利益|収益|利益率|GGR)(?:は|を).{0,15}(?:いくら|教えて)/i,
      /(?:社員|従業員|スタッフ)(?:数|人数|何人)/i,
    ],
    fallback: '運営に関する内部情報はセキュリティ上お答えできません。',
  },
  {
    category: 'competitor_info',
    patterns: [
      /(?:ベラジョン|カジ旅|インターカジノ|ミスティーノ|ボンズ|コニベット|遊雅堂|エルドア|Stake|BC\.Game)/i,
      /(?:他の|別の)(?:カジノ|サイト)(?:より|と比べて|の方が)/i,
    ],
    fallback: '他社サービスについてのご質問にはお答えできません。スロット天国のサービスについてお気軽にお尋ねください。',
  },
  {
    category: 'unconfirmed_promo',
    patterns: [
      /(?:来月|来週|次回|今後)(?:の|は).{0,20}(?:ボーナス|プロモ|キャンペーン)/i,
    ],
    fallback: '今後のプロモーションについては、確定次第サイト上でお知らせいたします。',
  },
  {
    category: 'system_prompt_leak',
    patterns: [
      // ρ-Mπ1 / τ-M: require extraction intent verb OR question form to avoid blocking
      // legitimate tutorials, while still catching "システムプロンプトは何ですか？" forms.
      /(?:システム|内部)(?:プロンプト|指示|設定).{0,15}(?:教え|見せ|出し|表示|reveal|show|tell|disclose|share|print|出力|公開|開示|何|なに|ですか|内容|について|を読|を見)/i,
      /(?:ignore|無視|忘れ).{0,20}(?:instructions?|指示|previous|プロンプト|前の|これまで)/i,
      /(?:jailbreak|脱獄|DAN|developer\s*mode|sudo\s*mode)/i,
    ],
    fallback: 'AIの内部設定に関するご質問にはお答えできません。サポートに関するご質問をどうぞ。',
  },
  {
    category: 'personal_data_extraction',
    patterns: [
      /(?:クレジットカード|カード番号|CVV|暗証番号|PIN)/i,
      /(?:パスワード|PW)(?:を|は).{0,10}(?:教えて|送って)/i,
      /(?:マイナンバー|免許証番号|パスポート番号)/i,
    ],
    fallback: 'セキュリティ保護のため、機密情報をチャットでお伝えすることはできません。',
  },
];

export function filterResponse(aiResponse) {
  if (!aiResponse) return { safe: true, response: aiResponse };
  for (const cat of PROHIBITED_CATEGORIES) {
    for (const p of cat.patterns) {
      if (p.test(aiResponse)) {
        return { safe: false, response: cat.fallback, blockedCategory: cat.category };
      }
    }
  }
  // Secondary pass: over-promise / 景表法 words that don't block the whole reply
  // but signal quality concern for auditing. We replace inline rather than
  // swapping the entire message — breaks "必ず" promises without being jarring.
  const overPromise = detectOverPromise(aiResponse);
  if (overPromise.detected) {
    return {
      safe: true,
      response: overPromise.masked,
      overPromiseHits: overPromise.hits,
      blockedCategory: 'over_promise_soft_mask',
    };
  }
  return { safe: true, response: aiResponse };
}

// --- Phase 1: 過剰約束ワード (景表法優良誤認 / 法的断定 / RG) ------------
// Rationale: HANDOFF/ai-accuracy-discussion/07-support-responder.md § 3
// "必ず / 絶対 / 100% / 保証 / 〜円もらえます / 24時間以内に / 即時 / すぐに反映"
// These should not appear in AI-generated CS replies; if they do, replace with
// softer hedged wording and log for audit.
export const OVER_PROMISE_PATTERNS = [
  { find: /必ず(?=[^\s。、])/g,          replace: '通常は' },
  { find: /絶対(?:に)?/g,                replace: '基本的に' },
  { find: /確実に/g,                     replace: '原則として' },
  { find: /100%/g,                       replace: 'ほぼ' },
  { find: /保証(?:い?たします|します)/g, replace: 'ご案内いたします' },
  { find: /即時(?:反映|処理)/g,          replace: 'お早めに反映' },
  { find: /すぐに反映/g,                 replace: 'お早めに反映' },
  { find: /24時間以内に/g,               replace: '通常 1 営業日を目安に' },
  { find: /(?:当選|勝利|勝て|儲か)(?:します|る)/g, replace: 'チャンスがあります' },
  { find: /\d+円(?:もらえ|差し上げ)/g,   replace: '特典をご案内' },
];

export function detectOverPromise(text) {
  if (!text || typeof text !== 'string') return { detected: false, hits: [], masked: text };
  const hits = [];
  let masked = text;
  for (const { find, replace } of OVER_PROMISE_PATTERNS) {
    const matches = masked.match(find);
    if (matches && matches.length) {
      hits.push(...matches.map((m) => ({ match: m, replacement: replace })));
      masked = masked.replace(find, replace);
    }
  }
  return { detected: hits.length > 0, hits, masked };
}

// --- Phase 1: Personal data demand — AI が顧客に個人情報を要求するのを防ぐ
// e.g. "パスワードを教えてください" を AI 出力に含ませない
export const PERSONAL_DATA_REQUEST_PATTERNS = [
  /パスワード.{0,10}(?:教え|お伝え|ご記入|送信|入力)/,
  /暗証番号.{0,10}(?:教え|お伝え|ご記入|送信|入力)/,
  /(?:銀行)?口座番号.{0,10}(?:教え|お伝え|ご記入|送信)/,
  /カード番号.{0,10}(?:教え|お伝え|ご記入|送信)/,
];

export function detectPersonalDataRequest(text) {
  if (!text) return false;
  return PERSONAL_DATA_REQUEST_PATTERNS.some((p) => p.test(text));
}

// ============================================
// C5: Prompt Injection Hardening
// ============================================

/**
 * Unicode/encoding normalization for bypass-resistant injection detection.
 * - Full-width ASCII → half-width
 * - Common homoglyph / Cyrillic / Greek lookalikes → ASCII
 * - Strip zero-width and bidi control characters
 * - Lowercase + whitespace collapse
 */
export function normalizeForInjectionCheck(s) {
  if (!s || typeof s !== 'string') return '';
  let out = s;
  // Full-width letters/digits → half-width
  out = out.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // Common Unicode lookalikes → ASCII
  const lookalikes = {
    'ｏ': 'o', 'Ｏ': 'O', 'ο': 'o', 'о': 'o', 'ρ': 'p', 'ι': 'i', 'ɩ': 'i',
    'ѕ': 's', 'с': 'c', 'е': 'e', 'а': 'a', 'ⅰ': 'i', 'Ⅰ': 'I',
  };
  for (const [k, v] of Object.entries(lookalikes)) out = out.split(k).join(v);
  // Lowercase
  out = out.toLowerCase();
  // Strip zero-width / bidi / BOM
  out = out.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  // Collapse whitespace
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Heuristic: try to decode long base64 runs and detect injection keywords inside.
 */
export function looksLikeBase64Injection(s) {
  if (!s || typeof s !== 'string') return false;
  const matches = s.match(/[A-Za-z0-9+/=]{40,}/g) || [];
  for (const m of matches) {
    try {
      const decoded = atob(m.replace(/[^A-Za-z0-9+/=]/g, ''));
      if (decoded && /ignore|previous|system|prompt|override|instruction|reveal|forget|発言|無視|上書|ロール/i.test(decoded)) {
        return true;
      }
    } catch (_) { /* not valid base64 */ }
  }
  return false;
}

/**
 * Core prompt-injection regex set. Run against BOTH normalized and raw input.
 */
export const INJECTION_PATTERNS = [
  // Original patterns
  /(?:ignore|disregard|forget).{0,30}(?:instructions?|rules?|prompt)/i,
  /(?:無視|忘れて|無効に).{0,20}(?:指示|ルール|プロンプト)/i,
  /(?:you\s+are\s+now|act\s+as|あなたは今から)/i,
  /(?:DAN|jailbreak|脱獄|developer\s+mode)/i,
  // C5 expansion — jailbreak / persona / reveal-prompt phrases
  /dan\s+mode|do\s+anything\s+now|developer\s+mode|jailbreak/i,
  /前の?(?:指示|プロンプト)を?(?:無視|忘れ)/i,
  /role\s*[:：]\s*(?:admin|system|root|developer)/i,
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i,
  /reveal\s+(?:your\s+)?(?:system|initial|hidden|secret)\s+(?:prompt|instructions?)/i,
  /you\s+are\s+now\s+(?:a|an|in)\b/i,
  /from\s+now\s+on\s+you\s+(?:are|will|must)/i,
  /tell\s+me\s+your\s+(?:system|instructions?|prompt)/i,
  /新しいペルソナ|別のキャラクター|人格.*(?:変更|交代)/i,
  // "システムプロンプトを教えて" / "内部指示を見せて" — Japanese prompt extraction
  /(?:システム|内部)(?:プロンプト|指示|設定).{0,15}(?:教え|見せ|出し|表示|公開|開示|何|なに|ですか|内容|について)/i,
  /base64|rot13|encoded\s+(?:message|instruction)/i,
  // Mixed-language: English verb + JP target (catches normalized full-width bypass)
  /(?:ignore|disregard|forget|override).{0,10}(?:前の|以前の|上の)?\s*(?:指示|プロンプト|ルール)/i,
  // Chinese
  /忽略\s*(之前|以前|所有|先前)?\s*(的)?\s*(指令|提示|规则|指示)/,
  /作为\s*(系统|管理员|开发者|超级用户)/,
  /扮演\s*(角色|人物|身份)/,
  /显示\s*(你的)?\s*(系统)?\s*(提示|指令)/,
  /破解|越狱|绕过/,
  // Korean
  /이전\s*(의)?\s*(지시|명령|프롬프트|규칙)\s*(을|를)?\s*(무시|잊어)/,
  /시스템\s*(관리자|루트|개발자)/,
  /(너|당신)\s*(는|은)\s*이제/,
];

/**
 * Heuristic: decode ROT13 of input and check for injection keywords.
 */
export function looksLikeRot13Injection(s) {
  if (!s || typeof s !== 'string') return false;
  const decoded = s.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  return /ignore|previous|system|prompt|override|instruction|reveal|forget/i.test(decoded);
}

const DATA_EXTRACTION_PATTERNS = [
  /(?:全ユーザー|全プレイヤー)(?:の|リスト|一覧|データ)/i,
  /(?:データベース|DB|SQL)(?:の|を|から).{0,15}(?:取得|ダンプ)/i,
];

export function detectInputThreat(userInput) {
  if (!userInput) return { suspicious: false };

  const normalized = normalizeForInjectionCheck(userInput);

  // 1. Run injection patterns against NORMALIZED text (catches full-width, homoglyph, case)
  for (const p of INJECTION_PATTERNS) {
    if (p.test(normalized)) return { suspicious: true, category: 'prompt_injection' };
  }

  // 2. Also run against RAW input (preserves CJK signal normalization may alter)
  for (const p of INJECTION_PATTERNS) {
    if (p.test(userInput)) return { suspicious: true, category: 'prompt_injection' };
  }

  // 3. Base64 payload heuristic
  if (looksLikeBase64Injection(userInput)) {
    return { suspicious: true, category: 'prompt_injection_base64' };
  }

  // 3b. ROT13 payload heuristic
  if (looksLikeRot13Injection(userInput)) {
    return { suspicious: true, category: 'prompt_injection_rot13' };
  }

  // 4. Data-extraction patterns (raw is fine; CJK-heavy)
  for (const p of DATA_EXTRACTION_PATTERNS) {
    if (p.test(userInput)) return { suspicious: true, category: 'data_extraction' };
  }

  // TODO(C5): Layer-2 LLM judge for borderline inputs (suspicious keywords but no hard
  // match). Deferred to keep the hot path synchronous and avoid extra Gemini calls.

  return { suspicious: false };
}
