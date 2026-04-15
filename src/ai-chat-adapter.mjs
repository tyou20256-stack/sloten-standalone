// AI chat adapter — provider-agnostic.
// Selects provider via env.AI_PROVIDER ("gemini" | "anthropic").
// Uses FAQ + knowledge_sources from D1 as grounding context.
//
// Phase 1: plain prompt concatenation. Embeddings / RAG ranking comes later.

import { recordAiCall } from './handlers/ai-logs.mjs';
import { pickActivePrompt } from './handlers/ai-prompts.mjs';
import { maskPII } from './pii-masker.mjs';

const MAX_CONTEXT_FAQ = 8;
const MAX_CONTEXT_KB = 3;

function buildSystemPrompt(faqRows, kbRows, header) {
  const faqText = faqRows.slice(0, MAX_CONTEXT_FAQ)
    .map((r) => `Q: ${r.question}\nA: ${r.answer}`)
    .join('\n\n');
  const kbText = kbRows.slice(0, MAX_CONTEXT_KB)
    .map((r) => `[${r.title || 'untitled'}]\n${(r.content || '').slice(0, 1500)}`)
    .join('\n\n---\n\n');
  const head = header || [
    'あなたはスロット天国のカスタマーサポート担当です。',
    '日本語で簡潔に、丁寧に回答してください。',
    'FAQ やナレッジに情報がない場合は「担当者におつなぎします」と案内してください。',
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
      'SELECT title, content FROM knowledge_sources WHERE is_active = 1 ORDER BY priority ASC, id DESC LIMIT ?'
    ).bind(MAX_CONTEXT_KB * 2).all(),
  ]);
  return { faqRows: faq.results || [], kbRows: kb.results || [] };
}

async function callGemini(apiKey, system, userMessage, model = 'gemini-2.5-flash-lite') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
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

async function callAnthropic(apiKey, system, userMessage) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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
  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();
  const model = provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gemini-2.5-flash-lite';
  const { faqRows, kbRows } = await loadContext(env, tenantId);

  // Choose active prompt via weighted random (A/B testing). Fall back to hard-coded.
  let promptRow = null;
  try { promptRow = await pickActivePrompt(env, tenantId); } catch (_) {}
  const promptHeader = promptRow ? promptRow.system_prompt : null;
  const system = buildSystemPrompt(faqRows, kbRows, promptHeader);

  const maskedInput = maskPII(customerMessage || '');
  const started = Date.now();
  let text = '';
  let status = 'ok';
  let errorMessage = null;

  try {
    // PII-masked input is sent to the LLM too — never forward raw emails/
    // phone numbers / account IDs to third-party providers.
    if (provider === 'anthropic') {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      text = await callAnthropic(env.ANTHROPIC_API_KEY, system, maskedInput);
    } else {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      text = await callGemini(env.GEMINI_API_KEY, system, maskedInput);
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
  if (!text) {
    return { content: 'ただいま担当者におつなぎします。少々お待ちください。', content_type: 'text' };
  }
  return { content: text, content_type: 'text' };
}
