-- @idempotent — 031-strip-operator-buttons.sql
-- MIGRATION-LINT: safe (deterministic single-row UPDATE; no data loss path)
--
-- Removes the "オペレーターと話す" / "オペレーターにつなぐ" menu buttons
-- (product decision 2026-05-15: customers reach a human via keyword /
-- RG / anger escalation, not via an explicit menu button).
--
-- Scope split:
--   - bot_menus.handoff-fallback: small fixed JSON → handled here in SQL.
--   - bot_flows 18-22 (sloten-main + bonus clones): the steps blob is
--     >100 KB and the operator button appears at ~227 per-step variable
--     array indices. Pure-SQL JSON surgery is impractical and the inline
--     SQL would exceed D1's statement size limit. Those flows are stripped
--     by scripts/strip-operator-buttons.mjs (idempotent, runs through the
--     worker admin API so steps go as a bound parameter). That script is a
--     MANDATORY post-flow-seed step — see DEPLOY-RUNBOOK.md.
--
-- handoff-fallback originally:
--   [{"title":"オペレーターにつなぐ","value":"オペレーター"},
--    {"title":"メニューに戻る","value":"メニュー"}]
-- After: drop the operator item, keep "メニューに戻る" so the fallback
-- menu still renders one actionable choice (keyword escalation remains the
-- human path). Guarded by the exact pre-image so re-runs / already-clean
-- DBs are no-ops (idempotent).

UPDATE bot_menus
   SET items = '[{"title":"メニューに戻る","value":"メニュー"}]',
       updated_at = datetime('now')
 WHERE trigger_type = 'fallback'
   AND name = 'handoff-fallback'
   AND items LIKE '%オペレーターにつなぐ%';
