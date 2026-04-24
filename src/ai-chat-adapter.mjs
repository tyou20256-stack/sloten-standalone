// AI chat adapter — provider-agnostic.
// Selects provider via env.AI_PROVIDER ("gemini" | "anthropic").
// Uses FAQ + knowledge_sources from D1 as grounding context.
//
// Phase 1: plain prompt concatenation. Embeddings / RAG ranking comes later.

import { recordAiCall } from './handlers/ai-logs.mjs';
import { pickActivePrompt } from './handlers/ai-prompts.mjs';
import { findKeywordMenu, findFallbackMenu, menuToMessagePayload } from './handlers/bot-menus.mjs';
import { maskPII } from './pii-masker.mjs';
import { filterResponse, detectInputThreat, detectOverPromise, detectPersonalDataRequest } from './responseFilter.mjs';
import { retrieveContext } from './retrieval.mjs';
import { decideEscalation } from './escalation.mjs';
import { scheduleShadowCalls } from './shadow.mjs';

const MAX_CONTEXT_FAQ = 10;   // FTS5 top-K — lower than legacy 15 to raise density
const MAX_CONTEXT_KB = 6;     // FTS5 top-K — lower than legacy 8 to raise density

function buildSystemPrompt(faqRows, kbRows, header) {
  const faqText = faqRows.slice(0, MAX_CONTEXT_FAQ)
    .map((r) => `Q: ${r.question}\nA: ${r.answer}`)
    .join('\n\n');
  const kbText = kbRows.slice(0, MAX_CONTEXT_KB)
    .map((r) => `[${r.title || 'untitled'}]\n${(r.content || '').slice(0, 3000)}`)
    .join('\n\n---\n\n');
  const head = header || [
    'あなたは「スロット天国」のAIカスタマーサポート担当です。',
    '',
    '## 基本ルール',
    '- 日本語で丁寧に（です・ます調で）回答してください。ナレッジベースに詳しい情報があれば**省略せず具体的に**案内してください。',
    '- **必ず下記の FAQ とナレッジベースの情報のみに基づいて回答してください。** 記載のない情報を推測や一般知識で補わないでください。',
    '- FAQ・ナレッジに情報がない場合は「担当者におつなぎしますので、少々お待ちください」と案内してください。',
    '- **入金の操作・手続き**（「入金したい」「振り込みたい」「PayPayで送金したい」等の実行依頼）にはメニュー誘導してください。ただし入金方法の種類・対応決済方法・出金の目安時間など**情報を聞いているだけの質問にはナレッジの情報に基づいて回答してください。**',
    '- 英語やその他の言語での質問には「申し訳ございませんが、現在は日本語のみの対応となっております」と回答してください。',
    '- 意味不明な入力には「ご質問内容を確認できませんでした。メニューからお選びいただくか、ご質問をお書きください」と案内してください。',
    '',
    '## スロット天国の基本情報（必ずこの情報を正として使用）',
    '- カスタマーサポートは **24時間対応** です。',
    '- ライセンス: **ジョージア（グルジア）iGaming サブライセンス N138/1**（有効期限: 2026年10月29日）。キュラソーではありません。',
    '- 本人確認（KYC）は原則不要。電話番号とメールアドレスのみで登録可能。',
    '- 入金方法: PayPayマネー、PayPayマネーライト、銀行振込、コンビニ入金、ATM、仮想通貨。',
    '- ドリームポット: 業界初の独自賞金プール機能。',
  ].join('\n');
  return [
    head,
    '',
    '=== FAQ ===',
    faqText || '(no FAQ entries)',
    '',
    '=== Knowledge Base ===',
    kbText || '(no knowledge base entries)',
  ].join('\n');
}

// Retrieval moved to src/retrieval.mjs — FTS5 BM25 when available, priority
// fallback otherwise. This function is kept as a thin wrapper so the adapter
// has a single call site.
async function loadContext(env, tenantId, userQuery) {
  return retrieveContext(env, tenantId, userQuery, {
    faqLimit: MAX_CONTEXT_FAQ,
    kbLimit: MAX_CONTEXT_KB,
  });
}

async function callGemini(apiKey, system, userMessage, model = 'gemini-2.5-flash-lite') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  // Capture token usage for cost tracking and per-prompt analysis.
  const usage = data?.usageMetadata || {};
  return {
    text,
    tokens_in: usage.promptTokenCount ?? null,
    tokens_out: usage.candidatesTokenCount ?? null,
  };
}

async function callAnthropic(apiKey, system, userMessage, model = 'claude-haiku-4-5') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = (data?.content?.[0]?.text || '').trim();
  return {
    text,
    tokens_in: data?.usage?.input_tokens ?? null,
    tokens_out: data?.usage?.output_tokens ?? null,
  };
}

export async function generateBotReply(env, { conversationId, tenantId, customerMessage, ctx, history, menuContext }) {
  // 0) Hard escalation — money / legal / account-freeze / RG / anger keywords
  //    bypass AI entirely and return a canned safe response. The caller is
  //    expected to also flip conversation.status → 'open' on handoff=true.
  const escalation = decideEscalation(customerMessage, history || []);
  if (escalation.shouldEscalate) {
    // Record this as an ai_log even though we skipped the LLM — so operators
    // can see why escalation fired and build Golden Set from it.
    const logPromise = recordAiCall(env, {
      tenant_id: tenantId,
      conversation_id: conversationId,
      provider: 'n/a',
      model: 'escalation',
      system_prompt: 'escalation',
      input: maskPII(customerMessage || ''),
      output: escalation.responseText,
      latency_ms: 0,
      status: 'escalated',
      error_message: null,
      prompt_id: null,
      escalation_reason: escalation.reason,
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(logPromise);
    else await logPromise;
    return {
      content: escalation.responseText,
      content_type: 'text',
      handoff: true,
      escalation_reason: escalation.reason,
    };
  }

  // 1) Keyword menu short-circuit — if the user's message matches a configured
  //    regex, skip the LLM entirely and return a menu instead. Much faster and
  //    zero AI cost for well-known intents.
  try {
    const kwMenu = await findKeywordMenu(env, tenantId, customerMessage);
    if (kwMenu) {
      const payload = menuToMessagePayload(kwMenu);
      if (payload) return payload;
    }
  } catch (_) { /* fall through to LLM */ }

  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();
  const model = provider === 'anthropic'
    ? (env.ANTHROPIC_MODEL || 'claude-haiku-4-5')
    : (env.GEMINI_MODEL || 'gemini-2.5-flash-lite');
  // FTS5 BM25 retrieval (or priority fallback). User query drives relevance.
  const retrieval = await loadContext(env, tenantId, customerMessage);
  const { faqRows, kbRows } = retrieval;

  // Choose active prompt via weighted random (A/B testing). Fall back to hard-coded.
  let promptRow = null;
  try { promptRow = await pickActivePrompt(env, tenantId); } catch (_) {}
  const promptHeader = promptRow ? promptRow.system_prompt : null;
  let system = buildSystemPrompt(faqRows, kbRows, promptHeader);

  // Fix 1 (enhancement): if the caller passed a menu context (user is on a
  // select step and asked free-form text), inject it so the AI acknowledges
  // the question, briefly explains what options the menu offers, and ends by
  // recommending a menu click. This replaces the old terse "メニューから
  // お選びください" reply with something UX-friendly.
  if (menuContext && menuContext.prompt && Array.isArray(menuContext.items) && menuContext.items.length) {
    const optionList = menuContext.items.map((it) => `- ${it.title || it.value}`).join('\n');
    system += [
      '',
      '',
      '## 🗂️ 現在のメニューコンテキスト',
      `ユーザーは現在「${menuContext.prompt}」のメニュー選択を求められています。`,
      '利用可能な選択肢:',
      optionList,
      '',
      '## 📝 回答ガイドライン (menu-context モード)',
      '1. ユーザーの質問内容に 1 文で共感・確認する (例: 「入金方法についてですね。」)。',
      '2. 上記の選択肢の内、関連するものを 2〜3 個だけ **日本語タイトル** で紹介する。',
      '3. 最後に「以下のメニューからお選びください」と締める (3 段階で合計 3〜4 行以内)。',
      '4. FAQ やナレッジに具体的な情報がある場合は短く引用して補足してもよい。',
    ].join('\n');
  }

  const maskedInput = maskPII(customerMessage || '');

  // Input threat detection — block prompt injection / data extraction before
  // sending to the LLM. This saves an API call and prevents adversarial inputs
  // from reaching the model.
  const threat = detectInputThreat(maskedInput);
  if (threat.suspicious) {
    return { content: 'サポートに関するご質問をお願いいたします。', content_type: 'text' };
  }

  const started = Date.now();
  let text = '';
  let tokensIn = null;
  let tokensOut = null;
  let status = 'ok';
  let errorMessage = null;
  let overPromiseHits = null;
  let outputBlockedCategory = null;

  try {
    // PII-masked input is sent to the LLM too — never forward raw emails/
    // phone numbers / account IDs to third-party providers.
    let result;
    if (provider === 'anthropic') {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      result = await callAnthropic(env.ANTHROPIC_API_KEY, system, maskedInput, model);
    } else {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      result = await callGemini(env.GEMINI_API_KEY, system, maskedInput, model);
    }
    text = result.text || '';
    tokensIn = result.tokens_in;
    tokensOut = result.tokens_out;
    if (!text) status = 'empty';
  } catch (e) {
    status = 'error';
    errorMessage = e.message;
  }

  // Output safety filter — block LLM responses that mention competitors,
  // leak internal info, or provide gambling/legal advice. Soft-mask also
  // runs to replace over-promise words (必ず/100% etc.) inline.
  if (text) {
    const filtered = filterResponse(text);
    if (!filtered.safe) {
      text = filtered.response;
      outputBlockedCategory = filtered.blockedCategory;
      status = 'filtered';
    } else if (filtered.blockedCategory === 'over_promise_soft_mask') {
      text = filtered.response;
      overPromiseHits = filtered.overPromiseHits;
    }
    // Additional guard: AI shouldn't ask for passwords / card numbers.
    if (detectPersonalDataRequest(text)) {
      text = 'セキュリティ上、機密情報はチャットではお預かりできません。担当者におつなぎいたします。';
      outputBlockedCategory = 'personal_data_request';
      status = 'filtered';
    }
  }

  // Record primary with retrieval trace + tokens + over-promise audit.
  // We await this (not waitUntil) so primaryLogId is known for shadow linking.
  const primaryLogId = await recordAiCall(env, {
    tenant_id: tenantId,
    conversation_id: conversationId,
    provider,
    model,
    system_prompt: promptHeader ? `prompt_id=${promptRow?.id}` : 'default',
    input: maskedInput,
    output: text,
    latency_ms: Date.now() - started,
    status,
    error_message: errorMessage,
    prompt_id: promptRow?.id || null,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    retrieval_trace: JSON.stringify({
      ...retrieval.trace,
      over_promise_hits: overPromiseHits,
      output_blocked: outputBlockedCategory,
    }),
  });

  // Shadow mode (Phase 2 D): fire-and-forget candidate prompt evaluation.
  // Uses ctx.waitUntil so user latency is unaffected. Off by default —
  // toggle via feature_flags `ai.shadow_mode.enabled` = '1'.
  scheduleShadowCalls(env, ctx, {
    primaryLogId,
    tenantId,
    conversationId,
    activePromptId: promptRow?.id || null,
    buildSystemPrompt: (header) => buildSystemPrompt(faqRows, kbRows, header),
    maskedInput,
    provider,
    model,
  });

  if (status === 'error') throw new Error(errorMessage);

  if (!text) {
    // 2) Empty AI response — try fallback menu, otherwise plain handoff text.
    try {
      const fb = await findFallbackMenu(env, tenantId);
      const payload = menuToMessagePayload(fb);
      if (payload) return payload;
    } catch (_) {}
    return { content: 'ただいま担当者におつなぎします。少々お待ちください。', content_type: 'text' };
  }
  return { content: text, content_type: 'text' };
}
