# Phase 2: Code QA Report

## Summary
- Files scanned: 32
- CRITICAL: 3
- HIGH: 5
- MEDIUM: 5

---

## Findings

### [CODE-001] Missing tenant_id on single-row conversation/contact/candidate lookups [CRITICAL]
- **File:** src/handlers/conversations-native.mjs:101,110,166 / contacts-native.mjs:28,39,58 / faq-candidates.mjs:30,61,78,98
- **Category:** data_integrity / security
- **Issue:** getConversation, updateConversation, markRead, getContact, listContactConversations, and all faq-candidates single-row handlers (update/approve/reject/bulk) look up rows by bare id with no AND tenant_id clause. Any authenticated staff can read or mutate rows from other tenants in multi-tenant deployment.
- **Evidence:** conversations-native.mjs:101 -- SELECT * FROM conversations WHERE id = ? (no tenant scope). contacts-native.mjs:39 -- SELECT * FROM contacts WHERE id = ? (no tenant scope). faq-candidates.mjs:30,61,78,98 -- same pattern.
- **Fix:** Add AND tenant_id = ? with resolveTenantId(request, env) to every single-row SELECT and UPDATE in these handlers.
- **Test:** Create two tenants. As staff of tenant A, GET /api/conversations/<tenant-B-id>. Currently returns data; should return 404.

---

### [CODE-002] knowledge_sources loaded without tenant_id filter in AI context [CRITICAL]
- **File:** src/ai-chat-adapter.mjs:58
- **Category:** data_integrity / security
- **Issue:** The AI context query has no tenant_id filter. All tenants share the same knowledge sources. An operator at tenant B can contaminate tenant A bot replies. The knowledge_sources schema (012-knowledge.sql) has no tenant_id column -- root architectural gap. The CSV export also marks it noTenant:true.
- **Evidence:** ai-chat-adapter.mjs:58 -- SELECT title, content FROM knowledge_sources WHERE is_active = 1 ORDER BY priority DESC, id DESC LIMIT ? (no tenant_id parameter).
- **Fix:** Add tenant_id TEXT NOT NULL DEFAULT tenant_default to knowledge_sources via new migration. Filter by tenant in AI context query and CSV export.
- **Test:** Insert KB rows for tenant A only; call AI as tenant B; KB content must not appear in system prompt.

---

### [CODE-003] Duplicate migration numbers with non-idempotent ALTER TABLE blocks safe re-runs [CRITICAL]
- **File:** migrations/010-bot-flows.sql:29 / scripts/apply-migrations.mjs:16
- **Category:** correctness
- **Issue:** 010-bot-flows.sql contains ALTER TABLE conversations ADD COLUMN flow_state TEXT. D1/SQLite does NOT support ADD COLUMN IF NOT EXISTS. Re-running apply-migrations.mjs on an existing schema fails with duplicate column name: flow_state and blocks all subsequent migrations. Six files share only three prefix numbers (010, 011, 012).
- **Evidence:** migrations/010-bot-flows.sql:29 -- ALTER TABLE conversations ADD COLUMN flow_state TEXT with no idempotency guard. apply-migrations.mjs:16 -- sort() only, no skip-already-applied logic.
- **Fix:** Renumber duplicate files to sequential 010-015. Guard ALTER TABLE with pragma_table_info check, or use a migration tracking table.
- **Test:** Run apply-migrations.mjs twice on empty local D1; second run must complete without error.

---

### [CODE-004] adminTestBot fires real GAS webhooks via ctx.waitUntil; cleanup non-atomic [HIGH]
- **File:** src/handlers/admin-ops.mjs:41, 55-59
- **Category:** correctness / data_integrity
- **Issue:** adminTestBot calls sendMessage with the real ctx. If a bonus code matches, forwardToGas fires via ctx.waitUntil inside sendMessage, sending a real bonus_code_submit to the external GAS webhook for a synthetic test contact. The waitUntil task survives after the finally cleanup. Three sequential DELETEs in finally are non-transactional; Worker kill between them leaves orphan rows.
- **Evidence:** admin-ops.mjs:41 -- sendMessage(fakeReq, env, corsHeaders, convId, {source:widget}, ctx) passes the real production ctx, triggering ctx.waitUntil(forwardToGas) for matched bonus codes.
- **Fix:** Pass no-op ctx { waitUntil: (p) => p.catch(()=>{}) } into sendMessage from adminTestBot. Wrap DELETEs in env.DB.batch([...]).
- **Test:** Configure bonus code with gas_type; trigger admin test with that code; verify no request reaches GAS.

---

### [CODE-005] deleteBotFlow lacks tenant scope; flow_state LIKE cleanup can false-match sibling IDs [HIGH]
- **File:** src/handlers/bot-flows.mjs:153-157
- **Category:** data_integrity
- **Issue:** DELETE is WHERE id = ? only (no tenant scope). The UPDATE conversation cleanup uses a LIKE pattern that false-matches: deleting flow id 5 also clears conversations whose JSON contains digit 5 in other fields (e.g. step_id:step_5, or flow_id:50). UPDATE also has no tenant scope.
- **Evidence:** bot-flows.mjs:153 -- DELETE FROM bot_flows WHERE id = ? (no tenant_id). Line 155-157: UPDATE conversations SET flow_state = NULL WHERE flow_state LIKE pattern (no tenant scope, no exact match).
- **Fix:** Add AND tenant_id = ? to DELETE. Replace LIKE with json_extract: WHERE tenant_id = ? AND json_extract(flow_state, $.flow_id) = ?.
- **Test:** Create flows with IDs 1 and 11. Delete flow 1. Verify conversations with flow_id=11 are unaffected.

---

### [CODE-006] updateBotFlow SELECT and UPDATE both lack tenant_id scope [HIGH]
- **File:** src/handlers/bot-flows.mjs:112, 147
- **Category:** data_integrity
- **Issue:** The existence-check SELECT and subsequent UPDATE are WHERE id = ? with no tenant scope. Staff from tenant A can PATCH a bot_flow owned by tenant B.
- **Evidence:** bot-flows.mjs:112 -- SELECT * FROM bot_flows WHERE id = ? (no tenant_id). Line 147: UPDATE bot_flows SET ... WHERE id = ? (no tenant_id).
- **Fix:** Add AND tenant_id = ? to both using resolveTenantId(request, env).
- **Test:** As staff of tenant A, PATCH bot_flow owned by tenant B. Should return 404; currently mutates it.

---

### [CODE-007] approveCandidate INSERT+UPDATE not atomic -- double-promotion risk [HIGH]
- **File:** src/handlers/faq-candidates.mjs:45-57
- **Category:** data_integrity
- **Issue:** promoteOne does a plain INSERT into faq followed by a separate UPDATE on faq_candidates with no transaction. Worker kill between the two leaves candidate pending; a second approve call creates a duplicate FAQ row.
- **Evidence:** faq-candidates.mjs:47-56 -- two separate prepare().run() calls (INSERT then UPDATE) with no batch/transaction wrapper.
- **Fix:** Use env.DB.batch([insertStmt, updateStmt]) to execute both in one implicit transaction.
- **Test:** Mock DB failure after INSERT; verify candidate stays pending and re-approval creates duplicate FAQ under current code.

---

### [CODE-008] Full AI provider error body stored in ai_logs -- potential PII echo [HIGH]
- **File:** src/ai-chat-adapter.mjs:76, 97
- **Category:** security
- **Issue:** On non-2xx API responses the full response body is embedded verbatim in the thrown Error message, stored in ai_logs.error_message and error_log.message. Provider error payloads may echo back fragments of request content even when input was PII-masked before sending.
- **Evidence:** ai-chat-adapter.mjs:76 -- throw new Error(Gemini HTTP + r.status + : + await r.text()); errorMessage = e.message stored in ai_logs. Anthropic path same at line 97.
- **Fix:** Truncate the error body: const body = (await r.text()).slice(0, 200); throw new Error(provider + HTTP + r.status + : + body).
- **Test:** Set invalid API key; send chat; check ai_logs.error_message for absence of user message fragments.

---

### [CODE-009] listBonusSubmissions returns contact_email to non-admin staff [MEDIUM]
- **File:** src/handlers/bonus-codes-admin.mjs:139 / src/index.mjs:435
- **Category:** security
- **Issue:** The query JOINs contacts and returns c.email AS contact_email. Route guarded by requireStaff (any staff), not requireAdminRole. Non-admin staff can enumerate all customer emails who submitted bonus codes.
- **Evidence:** bonus-codes-admin.mjs:139 -- SELECT s.*, c.email AS contact_email ... LEFT JOIN contacts c. index.mjs:435 uses requireStaff not requireAdminRole.
- **Fix:** Change route guard to requireAdminRole, or redact email in response, or remove the JOIN entirely.
- **Test:** Log in as non-admin staff; GET /api/bonus-code-submissions. Verify email absent from response.

---

### [CODE-010] bulkAction in faq-candidates fetches by bare id without tenant scope [MEDIUM]
- **File:** src/handlers/faq-candidates.mjs:98
- **Category:** data_integrity
- **Issue:** bulkAction iterates caller-supplied IDs and fetches each with WHERE id = ? (no tenant scope). Admin of tenant A can supply IDs from tenant B and promote/reject them.
- **Evidence:** faq-candidates.mjs:98 -- SELECT * FROM faq_candidates WHERE id = ? inside bulkAction loop with no tenant_id guard.
- **Fix:** Add AND tenant_id = ? using resolveTenantId(request, env).
- **Test:** As admin of tenant A, POST /api/faq-candidates/bulk with IDs from tenant B.

---

### [CODE-011] getConversation returns full contact row to widget customers [MEDIUM]
- **File:** src/handlers/conversations-native.mjs:100-105
- **Category:** security
- **Issue:** getConversation returns { conversation, contact } with the full contact row. Widget path calls this after ownership verification. Customers see staff-stored metadata, phone, and email on their contact record.
- **Evidence:** conversations-native.mjs:103-104 -- SELECT * FROM contacts WHERE id = ? then return ok({conversation, contact}); called from widget path at index.mjs:320.
- **Fix:** Accept opts parameter (as sendMessage does). For opts.source=widget, return only { id, name } from contact.
- **Test:** Store internal metadata on contact; from widget GET /api/widget/conversations/:id; verify metadata absent.

---

### [CODE-012] knowledge_sources export has no tenant scope -- undocumented decision [MEDIUM]
- **File:** src/handlers/export.mjs:45-48
- **Category:** data_integrity
- **Issue:** The knowledge CSV export returns all rows globally (noTenant:true). Consistent with current schema but undocumented. Any admin from any tenant gets all KB content.
- **Evidence:** export.mjs:46 -- query: () => SELECT * FROM knowledge_sources ORDER BY id DESC (noTenant: true).
- **Fix:** Add inline comment documenting the intentional global-scope decision, or add tenant_id to schema (see CODE-002) and filter here.
- **Test:** Documentation fix; no code change unless CODE-002 migration is applied.

---

## Migration Duplicate Number Analysis

apply-migrations.mjs sorts lexicographically. Actual execution order:
1. 010-bot-flows.sql -- ALTER TABLE conversations ADD COLUMN flow_state TEXT (NOT IDEMPOTENT)
2. 010-faq.sql -- safe (CREATE TABLE IF NOT EXISTS only)
3. 011-attachments.sql -- safe
4. 011-templates.sql -- safe
5. 012-faq-candidates.sql -- safe (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE)
6. 012-knowledge.sql -- safe

Only file 1 is dangerous on re-run. All others are idempotent. Renumbering all six eliminates ordering confusion.

---

## Review Summary

| Severity | Count | Status   |
|----------|-------|----------|
| CRITICAL | 3     | block    |
| HIGH     | 5     | warn     |
| MEDIUM   | 5     | info     |
| LOW      | 0     | pass     |

**Verdict: BLOCK -- 3 CRITICAL issues must be resolved before multi-tenant go-live or next production migration run.**

Priority fix order:
1. CODE-001 -- tenant_id missing on conversation/contact/candidate single-row lookups
2. CODE-002 -- knowledge_sources has no tenant_id; architectural decision needed now
3. CODE-003 -- duplicate migration numbers + non-idempotent ALTER TABLE
4. CODE-005/CODE-006 -- bot_flows remaining tenant scope gaps
5. CODE-004 -- adminTestBot GAS side-effects + non-atomic cleanup
6. CODE-007 -- non-atomic FAQ candidate promotion
7. CODE-008 through CODE-012 -- security hardening and PII hygiene
