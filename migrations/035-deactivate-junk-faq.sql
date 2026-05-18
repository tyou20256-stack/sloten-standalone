-- @idempotent — 035-deactivate-junk-faq.sql
-- MIGRATION-LINT: safe (sets is_active=0 on a fixed id allow-list; reversible)
--
-- 2026-05-18 accuracy audit P5a. seeds/seed-faq-from-history.sql auto-extracted
-- FAQ rows from raw chat history. Several have a NON-ANSWER body: the literal
-- menu string "ご希望の項目をお選びください。", content-free pleasantries
-- ("畏まりました。ありがとうございます。"), stall fillers ("少々お待ち
-- くださいませ。"), or a counter-question ("ご紹介でしょうか？").
--
-- Before P0 this was masked: Flash Lite ignored the FAQ-最優先 rule and
-- freelanced. After P0 the hardened prompt makes Haiku faithfully obey
-- "該当 FAQ があれば Answer をそのまま引用" — so when trigram/dense retrieval
-- surfaces one of these junk rows, the bot now quotes the junk verbatim
-- ("ご希望の項目をお選びください。" with no actual answer). Deactivating them
-- removes the misleading grounding without deleting data (is_active=0 is
-- reversible; faq_fts_au trigger keeps the FTS index consistent, and
-- retrieval already filters is_active=1).
--
-- Conservative allow-list: only rows whose answer carries ZERO standalone
-- informational value were chosen by manual review of all 52 active rows.
-- Terse-but-real answers (誕生日ボーナス→ない, 紹介報酬, etc.) are kept.
--
-- Idempotent: guarded by is_active=1, so re-runs / already-clean DBs no-op.

UPDATE faq
   SET is_active = 0,
       updated_at = datetime('now')
 WHERE is_active = 1
   AND id IN (82, 86, 98, 99, 129, 137, 150, 152, 189, 258, 264, 265, 266);
