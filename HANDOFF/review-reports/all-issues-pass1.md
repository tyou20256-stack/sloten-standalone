# All Issues — Overnight 2026-04-17

## Summary
- CRITICAL: 4
- HIGH: 11
- MEDIUM: 10
- Total above safety gate (CRITICAL+HIGH): 15

## Priority fix order for Phase 8

### CRITICAL
1. **CODE-003** — Duplicate migration numbers + non-idempotent ALTER TABLE (migrations/010-bot-flows.sql)
2. **PERF-012** — CSV export has no LIMIT (outage risk)
3. **CODE-001** — Missing tenant_id on conversations/contacts/faq-candidates single-row lookups (multi-tenant isolation gap)
4. **CODE-002** — knowledge_sources has no tenant_id column (architectural — DEFER, needs product decision)

### HIGH
5. **CODE-004** — adminTestBot fires real GAS webhooks; non-atomic cleanup
6. **CODE-005** — deleteBotFlow tenant scope + LIKE false-match cleanup
7. **CODE-006** — updateBotFlow missing tenant scope on SELECT/UPDATE
8. **CODE-007** — approveCandidate INSERT+UPDATE not atomic
9. **CODE-008** — Full AI provider error body stored in ai_logs (potential PII echo)
10. **PERF-001** — FAQ extractor upserts N+1 (sequential prepare per cluster)
11. **PERF-002** — Staff import N+1 (UPDATE per conversation per email)
12. **PERF-003** — FAQ bulk action N+1 (3 DB calls per id)
13. **PERF-004** — Bot-flow webhook attachment lookup N+1
14. **PERF-008** — conversations.flow_state DELETE full-scan (redundant cleanup)
15. **PERF-009** — conversations.snoozed_until no index → cron full-scan every minute
16. **PERF-013** — FAQ list + other admin list endpoints have no LIMIT
17. **PERF-016** — audit() / logError() block response instead of ctx.waitUntil
18. **PERF-018** — sendMessage has 8-12 sequential D1 awaits (parallelize)

### MEDIUM (deferred by default policy)
- CODE-009 — listBonusSubmissions leaks contact_email to non-admin staff
- CODE-010 — faq-candidates bulkAction missing tenant scope
- CODE-011 — getConversation returns full contact to widget
- CODE-012 — knowledge_sources export no tenant scope (documented-as-intended)
- PERF-005/006/010/011/014/015/017/019 — various minor perf

## Fix Strategy
Consolidate related fixes into commits to minimize churn. Run `npm test` after each commit.

- Commit 1: CODE-003 migration renumber + idempotent guards
- Commit 2: PERF-012 + PERF-013 export/list LIMITs
- Commit 3: CODE-008 AI error body sanitize
- Commit 4: CODE-007 FAQ promote batch atomic
- Commit 5: CODE-004 adminTestBot safety (no-op ctx + batch cleanup)
- Commit 6: PERF-009 snoozed_until partial index
- Commit 7: PERF-016 audit/logError ctx.waitUntil
- Commit 8: CODE-001/005/006 tenant isolation sweep
- Commit 9: PERF-001/003 batch upserts
