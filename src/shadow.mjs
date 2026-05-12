// src/shadow.mjs
// Shadow mode (HANDOFF/ai-accuracy-discussion/03-experiment-tracker.md §3):
// The primary (user-visible) prompt runs synchronously. Shadow prompts run
// fire-and-forget via ctx.waitUntil so the user sees no added latency.
// Shadow outputs are logged into ai_logs with is_shadow=1 and shadow_of
// pointing at the primary log id, for later pairwise scoring.

import { recordAiCall } from './handlers/ai-logs.mjs';

// Thin wrappers for LLM calls. We replicate the minimal shape used by
// ai-chat-adapter's callGemini/callAnthropic to avoid circular imports.
async function callGeminiMinimal(apiKey, system, user, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const d = await r.json();
  return {
    text: (d?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(),
    tokens_in: d?.usageMetadata?.promptTokenCount ?? null,
    tokens_out: d?.usageMetadata?.candidatesTokenCount ?? null,
  };
}

async function callAnthropicMinimal(apiKey, system, user, model) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 800, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}`);
  const d = await r.json();
  return {
    text: (d?.content?.[0]?.text || '').trim(),
    tokens_in: d?.usage?.input_tokens ?? null,
    tokens_out: d?.usage?.output_tokens ?? null,
  };
}

// Fetch shadow configuration from feature_flags (D1-backed, no redeploy).
async function loadShadowConfig(env) {
  try {
    const enabledRow = await env.DB.prepare(
      `SELECT value FROM feature_flags WHERE key = 'ai.shadow_mode.enabled'`,
    ).first();
    const idsRow = await env.DB.prepare(
      `SELECT value FROM feature_flags WHERE key = 'ai.shadow_mode.prompt_ids'`,
    ).first();
    const enabled = enabledRow?.value === '1';
    const ids = (idsRow?.value || '')
      .split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    return { enabled, promptIds: ids };
  } catch {
    return { enabled: false, promptIds: [] };
  }
}

// Load a specific prompt row by id.
async function loadPromptById(env, id) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, name, system_prompt FROM ai_prompts WHERE id = ?`,
    ).bind(id).first();
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget shadow executions. Called from ai-chat-adapter after the
 * primary LLM call returns.
 *
 * @param {*} env
 * @param {*} ctx
 * @param {object} args
 *   primaryLogId       Id of the primary ai_logs row (set after insert)
 *   tenantId           Tenant
 *   conversationId     Conversation
 *   activePromptId     The prompt id that served the user
 *   buildSystemPrompt  Fn(headerText) → full system prompt string
 *   maskedInput        User input, PII-masked
 *   provider           'gemini' | 'anthropic'
 *   model              Model name
 */
export async function scheduleShadowCalls(env, ctx, args) {
  const cfg = await loadShadowConfig(env);
  if (!cfg.enabled || cfg.promptIds.length === 0) return;

  // Skip the active prompt itself to avoid duplicate work.
  const shadowIds = cfg.promptIds.filter((id) => id !== args.activePromptId);
  if (shadowIds.length === 0) return;

  // Cap to 2 to bound cost (3x inference total: 1 primary + 2 shadow).
  const capped = shadowIds.slice(0, 2);

  const task = async () => {
    for (const pid of capped) {
      const row = await loadPromptById(env, pid);
      if (!row || !row.system_prompt) continue;
      const header = row.system_prompt;
      const system = args.buildSystemPrompt(header);
      const started = Date.now();
      let result = null;
      let status = 'ok';
      let errorMessage = null;
      try {
        if (args.provider === 'anthropic') {
          if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
          result = await callAnthropicMinimal(env.ANTHROPIC_API_KEY, system, args.maskedInput, args.model);
        } else {
          if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
          result = await callGeminiMinimal(env.GEMINI_API_KEY, system, args.maskedInput, args.model);
        }
      } catch (e) {
        status = 'error';
        errorMessage = e.message;
      }
      // Shadow log already runs inside ctx.waitUntil(task()) so we await the
      // returned promise rather than wrapping again. shadow_of references the
      // primary log id (now a UUID generated synchronously by the primary's
      // recordAiCall call — no race because the id is assigned client-side).
      await recordAiCall(env, {
        tenant_id: args.tenantId,
        conversation_id: args.conversationId,
        provider: args.provider,
        model: args.model,
        system_prompt: `shadow:prompt_id=${pid}`,
        input: args.maskedInput,
        output: result?.text || '',
        tokens_in: result?.tokens_in,
        tokens_out: result?.tokens_out,
        latency_ms: Date.now() - started,
        status,
        error_message: errorMessage,
        prompt_id: pid,
        is_shadow: 1,
        shadow_of: args.primaryLogId || null,
      }).promise;
    }
  };

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task());
  else task().catch(() => {});
}
