#!/usr/bin/env node
// Evaluate all active ai_prompts against the golden_set corpus.
// Writes to `golden_eval` table (populated by migration 020).
//
// Metrics per (prompt, question):
//   - Keyword Inclusion Score : 0..1 based on `must_contain`
//   - Must-not-contain violations : count of forbidden strings in response
//   - Expected Escalation match  : 1 iff AI did/didn't escalate as expected
//   - LLM-as-Judge score (1-5)  : Claude Haiku / Gemini judge (optional)
//
// Usage:
//   node scripts/eval-golden-set.mjs                  # quick: no LLM judge
//   node scripts/eval-golden-set.mjs --judge          # include LLM judge
//   node scripts/eval-golden-set.mjs --prompt-id=5    # single prompt
//   node scripts/eval-golden-set.mjs --limit=20       # first N golden set rows
//
// Rate limit: simple sleep between LLM calls to stay under Gemini free tier.

import { writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONFIG = 'wrangler.staging-bk.toml';
const DB = 'sloten_standalone_db_staging_bk';
const TMP = 'seeds/_eval-results.sql';

const args = process.argv.slice(2);
const USE_JUDGE = args.includes('--judge');
const LIMIT = (() => {
  const m = args.find((a) => a.startsWith('--limit='));
  return m ? parseInt(m.slice(8), 10) : null;
})();
const ONLY_PROMPT_ID = (() => {
  const m = args.find((a) => a.startsWith('--prompt-id='));
  return m ? parseInt(m.slice(12), 10) : null;
})();
const BATCH_ID = randomUUID();

function d1(cmd, json = true) {
  const output = execSync(
    `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --command ${JSON.stringify(cmd)}${json ? ' --json' : ''}`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  if (!json) return output;
  const parsed = JSON.parse(output);
  return parsed[0]?.results || [];
}

async function gemini(apiKey, system, user) {
  const model = 'gemini-2.5-flash-lite';
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
  return (d?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

async function llmJudge(apiKey, question, reference, candidate) {
  // Simple pairwise structured scoring prompt.
  const system = [
    'あなたはカスタマーサポート AI 回答の品質評価者です。',
    '次の観点で 1-5 のスコアを返してください (5=最良、1=最悪):',
    '  1. 事実性 (回答が質問に対して正しく答えているか)',
    '  2. 丁寧さ (日本語の敬語・トーン)',
    '  3. 範囲 (質問から逸れていないか、推測していないか)',
    '',
    '必ず JSON で返してください: { "score": 4.2, "reasoning": "..." }',
  ].join('\n');
  const userPrompt = [
    '--- 質問 ---', question,
    '',
    '--- 候補回答 (AI) ---', candidate,
    '',
    reference ? ['--- 模範回答 ---', reference].join('\n') : '(模範回答なし — 一般的な高品質サポート回答を基準とせよ)',
  ].join('\n');
  try {
    const out = await gemini(apiKey, system, userPrompt);
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return { score: null, reasoning: 'judge JSON parse failed' };
    const parsed = JSON.parse(m[0]);
    return {
      score: typeof parsed.score === 'number' ? parsed.score : null,
      reasoning: String(parsed.reasoning || '').slice(0, 800),
    };
  } catch (e) {
    return { score: null, reasoning: `judge error: ${e.message.slice(0, 200)}` };
  }
}

function keywordInclusionScore(text, mustContain) {
  if (!Array.isArray(mustContain) || mustContain.length === 0) return 1;
  const body = String(text || '');
  const hits = mustContain.filter((kw) => body.includes(kw)).length;
  return hits / mustContain.length;
}

function mustNotViolations(text, mustNotContain) {
  if (!Array.isArray(mustNotContain) || mustNotContain.length === 0) return 0;
  const body = String(text || '');
  return mustNotContain.filter((kw) => body.includes(kw)).length;
}

function didEscalate(text) {
  // Simple heuristic: our canned escalation responses all contain "担当者"
  // or "相談窓口". Real judge would be more nuanced.
  const t = String(text || '');
  return /担当者|相談窓口|ご対応させていただきます/.test(t);
}

async function evaluate() {
  // Load prompts
  const promptSql = ONLY_PROMPT_ID
    ? `SELECT id, name, system_prompt FROM ai_prompts WHERE id = ${ONLY_PROMPT_ID}`
    : `SELECT id, name, system_prompt FROM ai_prompts WHERE is_active = 1 AND length(trim(system_prompt)) > 10`;
  const prompts = d1(promptSql);
  console.log(`Prompts to evaluate: ${prompts.length}`);
  if (prompts.length === 0) { console.error('No active prompts found.'); process.exit(1); }

  // Load golden set
  let goldenSql = `SELECT id, category, question, must_contain, must_not_contain, expected_escalation, reference_answer ` +
                  `FROM golden_set WHERE tenant_id = 'tenant_default' ORDER BY id`;
  if (LIMIT) goldenSql += ` LIMIT ${LIMIT}`;
  const golden = d1(goldenSql);
  console.log(`Golden set rows: ${golden.length}`);

  // Load environment (for GEMINI_API_KEY from wrangler secret list — but we
  // can't read secrets directly; caller must supply GEMINI_API_KEY env).
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('Note: GEMINI_API_KEY not set in shell env.');
    console.warn('This script calls the Gemini API directly (not through worker).');
    console.warn('Export GEMINI_API_KEY=... or run with --no-llm (keyword-only).');
    if (USE_JUDGE) { console.error('--judge requires GEMINI_API_KEY. Aborting.'); process.exit(1); }
    console.log('Continuing with deterministic keyword scoring only...');
  }

  const results = [];
  let done = 0, failed = 0;
  console.log(`\nRunning ${prompts.length} prompts × ${golden.length} questions = ${prompts.length * golden.length} LLM calls...`);
  for (const prompt of prompts) {
    for (const gs of golden) {
      const mustContain = JSON.parse(gs.must_contain || '[]');
      const mustNotContain = JSON.parse(gs.must_not_contain || '[]');
      const expectedEsc = Boolean(gs.expected_escalation);

      // We can evaluate prompts without calling the worker by calling Gemini
      // directly with (system_prompt + FAQ+KB excerpt injection is skipped
      // here — this measures prompt-quality, not retrieval-quality).
      if (!apiKey) {
        results.push({
          prompt_id: prompt.id,
          golden_set_id: gs.id,
          ai_response: '(skipped — no API key)',
          keyword_inclusion_score: null,
          must_not_contain_violated: null,
          expected_escalation_match: null,
          judge_score: null,
          judge_reasoning: null,
          latency_ms: 0,
          tokens_in: null,
          tokens_out: null,
        });
        continue;
      }

      const started = Date.now();
      let response = '';
      try {
        response = await gemini(apiKey, prompt.system_prompt, gs.question);
      } catch (e) {
        failed++;
        response = `(gemini error: ${e.message})`;
      }
      const latency = Date.now() - started;

      const kScore = keywordInclusionScore(response, mustContain);
      const mnv = mustNotViolations(response, mustNotContain);
      const escMatch = didEscalate(response) === expectedEsc ? 1 : 0;

      let judgeScore = null, judgeReasoning = null;
      if (USE_JUDGE) {
        await new Promise((r) => setTimeout(r, 300));
        const j = await llmJudge(apiKey, gs.question, gs.reference_answer || '', response);
        judgeScore = j.score;
        judgeReasoning = j.reasoning;
      }

      results.push({
        prompt_id: prompt.id,
        golden_set_id: gs.id,
        ai_response: response,
        keyword_inclusion_score: kScore,
        must_not_contain_violated: mnv,
        expected_escalation_match: escMatch,
        judge_score: judgeScore,
        judge_reasoning: judgeReasoning,
        latency_ms: latency,
        tokens_in: null,   // gemini responses don't include usage in this minimal call
        tokens_out: null,
      });
      done++;
      if (done % 10 === 0) console.log(`  progress: ${done}/${prompts.length * golden.length}`);
      // Rate-limit to avoid 429s on Gemini free tier
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.log(`\nDone: ${done} eval rows, ${failed} failures`);

  // Persist to golden_eval
  const escSql = (s) => String(s ?? '').replace(/'/g, "''");
  const lines = [];
  for (const r of results) {
    lines.push(
      `INSERT INTO golden_eval (prompt_id, golden_set_id, ai_response, keyword_inclusion_score, ` +
      `must_not_contain_violated, expected_escalation_match, judge_score, judge_reasoning, ` +
      `latency_ms, tokens_in, tokens_out, run_batch_id) VALUES (` +
      `${r.prompt_id}, ${r.golden_set_id}, '${escSql((r.ai_response || '').slice(0, 4000))}', ` +
      `${r.keyword_inclusion_score ?? 'NULL'}, ${r.must_not_contain_violated ?? 'NULL'}, ` +
      `${r.expected_escalation_match ?? 'NULL'}, ${r.judge_score ?? 'NULL'}, ` +
      `'${escSql((r.judge_reasoning || '').slice(0, 2000))}', ` +
      `${r.latency_ms || 0}, ${r.tokens_in ?? 'NULL'}, ${r.tokens_out ?? 'NULL'}, ` +
      `'${BATCH_ID}');`,
    );
  }
  if (lines.length === 0) { console.log('No rows to persist.'); return; }
  writeFileSync(TMP, lines.join('\n'));
  try {
    console.log(`\nPersisting ${lines.length} rows to golden_eval (batch ${BATCH_ID})...`);
    execSync(
      `npx wrangler d1 execute ${DB} --config ${CONFIG} --remote --file=${TMP}`,
      { stdio: 'inherit', maxBuffer: 50 * 1024 * 1024 },
    );
  } finally {
    try { unlinkSync(TMP); } catch (_) {}
  }

  // Summary per prompt
  console.log('\n=== Summary per prompt ===');
  for (const prompt of prompts) {
    const rs = results.filter((r) => r.prompt_id === prompt.id);
    const validK = rs.filter((r) => r.keyword_inclusion_score != null);
    const avgK = validK.length ? validK.reduce((s, r) => s + r.keyword_inclusion_score, 0) / validK.length : 0;
    const violations = rs.reduce((s, r) => s + (r.must_not_contain_violated || 0), 0);
    const escMatches = rs.filter((r) => r.expected_escalation_match === 1).length;
    const avgLat = Math.round(rs.reduce((s, r) => s + (r.latency_ms || 0), 0) / Math.max(rs.length, 1));
    const avgJudge = (() => {
      const j = rs.filter((r) => r.judge_score != null);
      return j.length ? (j.reduce((s, r) => s + r.judge_score, 0) / j.length).toFixed(2) : 'n/a';
    })();
    console.log(`  ${prompt.name} (id=${prompt.id}):`);
    console.log(`    avg keyword inclusion: ${(avgK * 100).toFixed(1)}%`);
    console.log(`    must-not violations: ${violations}`);
    console.log(`    expected esc match: ${escMatches}/${rs.length}`);
    console.log(`    avg latency: ${avgLat}ms`);
    console.log(`    avg judge score: ${avgJudge}`);
  }
}

evaluate().catch((e) => { console.error('FATAL:', e); process.exit(1); });
