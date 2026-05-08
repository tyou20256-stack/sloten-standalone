// Synthetic uptime probe — runs daily to verify the AI chat path works
// end-to-end, simulating a real customer query against ourselves. Catches
// regressions that don't show up in single-component health checks (e.g.
// AI provider key valid but RAG broken, FAQ DB online but FTS5 corrupt).
//
// Triggered from scheduled.mjs at 00:10 UTC = 09:10 JST. Records result to
// ai_logs with provider='synthetic' so it appears alongside real traffic
// for easy comparison.

import { generateBotReply } from '../ai-chat-adapter.mjs';
import { recordAiCall } from './ai-logs.mjs';

// Expected substrings — the synthetic probe should hit FAQ paths reliably.
// Don't pick too narrow a phrase or transient Gemini variation could trip.
const PROBES = [
  { input: 'PayPay入金方法', expectAny: ['PayPay', '入金'] },
  { input: 'KYCは必要？', expectAny: ['KYC', '不要'] },
];

async function runOneProbe(env, probe, ctx, tenantId) {
  const start = Date.now();
  let ok = false;
  let preview = '';
  let err = null;
  try {
    const r = await generateBotReply(env, {
      conversationId: 'synthetic-uptime',
      tenantId,
      customerMessage: probe.input,
      ctx,
      history: [],
    });
    preview = String(r?.content || '').slice(0, 120);
    ok = probe.expectAny.some((p) => preview.includes(p));
  } catch (e) {
    err = e.message;
  }
  const latency = Date.now() - start;
  return { ok, preview, err, latency, input: probe.input };
}

/**
 * Run all synthetic probes and aggregate result. Logs to ai_logs.
 * Returns { ok, results, p95 }.
 */
export async function runSyntheticUptime(env, ctx) {
  const tenantId = env.DEFAULT_TENANT_ID || 'tenant_default';
  const results = [];
  for (const probe of PROBES) {
    results.push(await runOneProbe(env, probe, ctx, tenantId));
    // Spread the probes by 2s so we don't hammer Gemini quota
    await new Promise((s) => setTimeout(s, 2000));
  }
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const allOk = passed === total;
  const latencies = results.map((r) => r.latency).sort((a, b) => a - b);
  const p95 = latencies[Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1)] || 0;

  // Record to ai_logs for trend tracking
  await recordAiCall(env, {
    tenant_id: tenantId,
    conversation_id: 'synthetic-uptime',
    provider: 'synthetic',
    model: 'uptime-probe',
    system_prompt: 'synthetic',
    input: PROBES.map((p) => p.input).join(' / '),
    output: `${passed}/${total} probes ok, p95=${p95}ms`,
    latency_ms: p95,
    status: allOk ? 'ok' : 'degraded',
    error_message: allOk ? null : results.filter((r) => !r.ok).map((r) => r.err || 'no_match').join(';'),
    prompt_id: null,
    retrieval_trace: JSON.stringify({ synthetic: true, results }),
  }).catch(() => {});

  console.log(`[synthetic-uptime] ${passed}/${total} probes ok, p95=${p95}ms`);

  // Telegram alert on failure
  if (!allOk && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const msg = `🚨 *Synthetic uptime failure*\n${passed}/${total} probes passed\np95: ${p95}ms\n\n` +
      results.filter((r) => !r.ok).map((r) => `• "${r.input}" → "${r.preview}"${r.err ? ' [err: ' + r.err + ']' : ''}`).join('\n');
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' }),
    }).catch(() => {});
  }

  return { ok: allOk, passed, total, p95, results };
}
