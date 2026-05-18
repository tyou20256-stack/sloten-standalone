-- @idempotent — 032-fix-active-ai-prompt.sql
-- MIGRATION-LINT: safe (single-row UPDATE, guarded by pre-image; no data loss)
--
-- Root cause of low AI accuracy (2026-05-18 audit):
--   The active DB prompt ai_prompts id=5 ('default-C-tiered') did NOT contain
--   the 最優先ルール (KYC原則不要 / 言語 / 方法→手順引用 / 入出金混同禁止).
--   buildSystemPrompt() used a truthy DB header to REPLACE the strong
--   hardcoded prompt wholesale, so the model never saw those hard rules.
--   Result: "本人確認は必要？" → "本人確認(KYC)を実施しております" (opposite
--   of the truth, and no FAQ even says that — pure hallucination), and
--   方法/やり方 questions deflected to a bare menu (最優先ルール#3 violation).
--
-- Fix has two layers:
--   1. Code: buildSystemPrompt now ALWAYS prepends the 最優先ルール + 基本情報
--      (mandatory block) and demotes the DB prompt to an additive
--      persona/style layer that can never strip safety rules.
--   2. This migration: rewrite id=5 to a clean persona/style + 3段階
--      エスカレーション layer (the mandatory rules are auto-prepended by code,
--      so they are intentionally NOT duplicated here to save prompt tokens).
--
-- Idempotency: guarded by the new prompt's '## 回答スタイル' heading, which
-- the old content lacks. Re-runs / already-fixed DBs are no-ops.

UPDATE ai_prompts
   SET system_prompt =
'## 回答スタイル
- 日本語で丁寧に（です・ます調）回答してください。結論を先に述べ、必要に応じて手順を箇条書きで示してください。
- 回答は80〜200字を目安に簡潔に。手順を説明する場合は200〜400字まで許容します。
- **必ず FAQ とナレッジベースの情報のみに基づいて回答**し、記載のない情報を推測や一般知識で補わないでください。
- 「方法」「やり方」「手順」を問われたら、FAQ・ナレッジから**具体的な手順を必ず引用**してください。メニュー誘導のみの回答は禁止です。
- 該当情報が無い場合は「担当者におつなぎしますので、少々お待ちください」と案内してください。

## 3段階エスカレーション方針
情報が不完全な場合、以下の順で段階的に対応してください:
1. FAQ・ナレッジから該当情報を最大限引用して回答する。
2. 部分的にしか答えられない場合は分かる範囲を答え、不足分にオペレーター案内を添える。
3. 全く該当情報が無い場合のみ「担当者におつなぎします」と案内する。',
       updated_at = datetime('now')
 WHERE id = 5
   AND system_prompt NOT LIKE '%## 回答スタイル%';
