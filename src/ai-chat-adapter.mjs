// AI chat adapter — provider-agnostic.
// Selects provider via env.AI_PROVIDER ("gemini" | "anthropic").
// Uses FAQ + knowledge_sources from D1 as grounding context.
//
// Phase 1: plain prompt concatenation. Embeddings / RAG ranking comes later.

import { recordAiCall } from './handlers/ai-logs.mjs';
import { pickActivePrompt } from './handlers/ai-prompts.mjs';
import { findKeywordMenu, findFallbackMenu, menuToMessagePayload } from './handlers/bot-menus.mjs';
import { maskPII } from './pii-masker.mjs';
import { filterResponse, detectInputThreat } from './responseFilter.mjs';

const MAX_CONTEXT_FAQ = 15;
const MAX_CONTEXT_KB = 8;

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

async function loadContext(env, tenantId) {
  const [faq, kb] = await Promise.all([
    env.DB.prepare(
      'SELECT question, answer, category FROM faq WHERE tenant_id = ? AND is_active = 1 ORDER BY priority DESC, usage_count DESC LIMIT ?'
    ).bind(tenantId, MAX_CONTEXT_FAQ * 2).all(),
    env.DB.prepare(
      'SELECT title, content FROM knowledge_sources WHERE is_active = 1 ORDER BY priority DESC, id DESC LIMIT ?'
    ).bind(MAX_CONTEXT_KB * 2).all(),
  ]);
  return { faqRows: faq.results || [], kbRows: kb.results || [] };
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
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
  const text = data?.content?.[0]?.text || '';
  return text.trim();
}

export async function generateBotReply(env, { conversationId, tenantId, customerMessage, ctx }) {
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
  const { faqRows, kbRows } = await loadContext(env, tenantId);

  // Choose active prompt via weighted random (A/B testing). Fall back to hard-coded.
  let promptRow = null;
  try { promptRow = await pickActivePrompt(env, tenantId); } catch (_) {}
  const promptHeader = promptRow ? promptRow.system_prompt : null;
  const system = buildSystemPrompt(faqRows, kbRows, promptHeader);

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
  let status = 'ok';
  let errorMessage = null;

  try {
    // PII-masked input is sent to the LLM too — never forward raw emails/
    // phone numbers / account IDs to third-party providers.
    if (provider === 'anthropic') {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      text = await callAnthropic(env.ANTHROPIC_API_KEY, system, maskedInput, model);
    } else {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      text = await callGemini(env.GEMINI_API_KEY, system, maskedInput, model);
    }
    if (!text) status = 'empty';
  } catch (e) {
    status = 'error';
    errorMessage = e.message;
  }

  // Log (best-effort — never block reply on log failure)
  // system_prompt is NOT persisted verbatim to avoid KB content leaking via
  // CSV exports. The prompt_id + truncated header snippet is enough to
  // reconstruct which variant was used.
  // Use ctx.waitUntil so the write survives response return on short-lived
  // Worker isolates; if ctx isn't provided, fall back to awaiting inline.
  const logPromise = recordAiCall(env, {
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
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(logPromise);
  else await logPromise;

  if (status === 'error') throw new Error(errorMessage);

  // Output safety filter — block LLM responses that mention competitors,
  // leak internal info, or provide gambling/legal advice.
  if (text) {
    const filtered = filterResponse(text);
    if (!filtered.safe) {
      text = filtered.response; // Replace with safe fallback
    }
  }

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
