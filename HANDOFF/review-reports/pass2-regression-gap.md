# Phase Review 2: Regression + Gap Analysis

## Summary
- Tenant gaps found: 11
- Regressions in overnight commits: 4
- New-code issues: 3

---

## Tenant gaps

### [GAP-001] bot-menus.mjs:74 — updateBotMenu has no tenant scope [HIGH]
- **Issue**: `SELECT * FROM bot_menus WHERE id = ?` then `UPDATE bot_menus SET ... WHERE id = ?` — both without tenant_id filter
- **Risk**: Any admin can modify another tenant's bot menu by knowing/guessing foreign id
- **Fix**: Add `AND tenant_id = ?` to both SELECT and UPDATE

### [GAP-002] bot-menus.mjs:106 — deleteBotMenu has no tenant scope and no existence check [HIGH]
- **Issue**: `DELETE FROM bot_menus WHERE id = ?` — no ownership check, no pre-delete SELECT, always returns 200
- **Risk**: Silent cross-tenant deletion
- **Fix**: Pre-check + scoped DELETE with 404 on foreign ids

### [GAP-003] faq.mjs:62 — handleFaqGetOne has no tenant scope [MEDIUM]
- **Issue**: `SELECT * FROM faq WHERE id = ?`
- **Risk**: FAQ content leaks across tenants
- **Fix**: Add `AND tenant_id = ?`

### [GAP-004] faq.mjs:114 — handleFaqPut has no tenant scope [HIGH]
- **Issue**: Both SELECT and UPDATE use bare `WHERE id = ?`
- **Risk**: Cross-tenant FAQ overwrite
- **Fix**: Tenant-scope both statements

### [GAP-005] faq.mjs:151 — handleFaqDelete has no tenant scope [HIGH]
- **Issue**: Both existence check and DELETE use bare `WHERE id = ?`
- **Fix**: Tenant-scope both

### [GAP-006] templates.mjs:79 — handleTemplatesPut has no tenant scope + TPL_COLS includes tenant_id [HIGH]
- **Issue**: Double vulnerability — missing tenant filter + TPL_COLS allows body.tenant_id to overwrite ownership
- **Fix**: Tenant scope SELECT/UPDATE; remove `'tenant_id'` from TPL_COLS

### [GAP-007] templates.mjs:105 — handleTemplatesDelete has no tenant scope [HIGH]
- **Fix**: Same pattern

### [GAP-008] teams.mjs:45 — updateTeam + deleteTeam missing tenant scope [HIGH]
- **Issue**: Update/delete use bare `WHERE id = ?`. Also createTeam uses body.tenant_id injection
- **Fix**: Resolve tenantId, scope everything; atomic cleanup via D1.batch()

### [GAP-009] labels.mjs:45 — updateLabel has no tenant scope [HIGH]

### [GAP-010] labels.mjs:71 — deleteLabel + cross-tenant conversations UPDATE [HIGH]
- **Critical**: The follow-up `UPDATE conversations SET labels = ...` has no tenant_id filter
- **Risk**: Deleting "VIP" label in tenant A strips "VIP" from all tenants' conversations
- **Fix**: Scope everything including the conversations cleanup UPDATE

### [GAP-011] ai-logs.mjs:48,55 — getAiLog + deleteAiLog have no tenant scope [MEDIUM]
- **Fix**: Add `AND tenant_id = ?` to both

---

## Regressions from overnight commits

### [REG-001] faq-candidates.mjs:56 — promoteOneBatch misleading name; not actually atomic [MEDIUM]
- **Commit**: `e7c5df4`
- **Issue**: Named "Batch" but implementation is plain INSERT then UPDATE (no D1.batch()). A Worker kill between the two statements leaves the candidate as pending, and a second approve creates a duplicate FAQ row.
- **Fix**: Add `status = 'pending'` guard to UPDATE; if `changes === 0`, delete the orphan INSERT and throw 'candidate already promoted' (409 on concurrent approve)

### [REG-002] ai-logs.mjs:92 — aiStats thumbs count is cross-tenant [MEDIUM]
- **Commit**: `311318f` (missed during the security sweep)
- **Issue**: 4 of 5 parallel queries are tenant-scoped. The thumbs aggregate `SELECT ... FROM ai_log_feedback` has no tenant filter; ai_log_feedback has no tenant_id column.
- **Fix**: JOIN `ai_logs l ON l.id = f.ai_log_id` and filter `l.tenant_id = ?`

### [REG-003] bot-flows.mjs:161 — lazy flow_state cleanup leaves stale state in operator UI [MEDIUM]
- **Commit**: `2e016e0` removed the eager cleanup but lazy cleanup only runs on next customer message
- **Risk**: Operator UI reads conversations.flow_state directly to display current flow; may show a reference to a deleted flow until next message
- **Fix**: Restore targeted tenant-scoped json_extract-based cleanup (exact match, not LIKE)

### [REG-004] audit.mjs:57 — logError reads context.__ctx instead of request.__ctx [LOW]
- **Commit**: `adb5576`
- **Issue**: In `audit()`, ctx is correctly read from `request?.__ctx`. In `logError()`, it's read from `context?.__ctx` — but context is the application payload (`{ conversation_id: ... }`) and never carries __ctx. So `ctx.waitUntil` never fires for error logging — the performance optimization is silently inoperative.
- **Fix**: Add optional 5th `request` parameter to logError; use `request?.__ctx`

---

## New-code issues

### [NEW-001] ai-prompts.mjs:44 — createPrompt uses body.tenant_id instead of resolveTenantId [HIGH]
- **Issue**: `body.tenant_id || env.DEFAULT_TENANT_ID || 'tenant_default'` — any caller can POST arbitrary `tenant_id` and create prompts in another tenant
- **Fix**: Use `resolveTenantId(request, env)` like every other handler

### [NEW-002] ai-prompts.mjs:67,74 — updatePrompt + deletePrompt have no tenant scope [HIGH]
- **Fix**: Resolve tenantId, scope both; add pre-delete existence check

### [NEW-003] admin-ops.mjs:218 — env_overrides backup intentionally global [LOW]
- **Issue**: env_overrides has no tenant_id column; backup runs global SELECT
- **Note**: This is architecturally correct. Documented as intentional — comment added.

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 14    | warn   |
| MEDIUM   | 4     | info   |
| LOW      | 2     | note   |

**Verdict**: WARNING — 14 HIGH issues should be resolved before multi-tenant go-live.
In single-tenant today: exploitable only by a rogue authenticated admin, not external attacker.

---

## Priority order for fixes

1. **GAP-002** (`deleteBotMenu`) — only delete handler without both guard AND existence check
2. **GAP-010 + REG-?** (`deleteLabel`) — only gap causing cross-resource mutation in single-tenant
3. **NEW-001** (`createPrompt`) — tenant_id injection vector
4. **NEW-002** (`updatePrompt` / `deletePrompt`) — mirrors pattern already fixed elsewhere
5. **GAP-004~007** (faq + templates update/delete)
6. **GAP-008/009** (teams/labels update)
7. **REG-001** (`promoteOne`) — fix misleading atomicity claim or add UNIQUE constraint
8. **REG-002** (thumbs aggregate) — cross-tenant metric leak
9. **REG-003** (flow_state stale) — restore targeted cleanup
10. **REG-004** (logError ctx) — trivial signature change

---

## 修正状況 (引き継ぎ時点)

全 18 件修正済み (commit `e9edca6` で 15 件、`fccd18d` で staff-admin の追加 gap も含む)。
詳細は `06-commit-list.md` を参照。
