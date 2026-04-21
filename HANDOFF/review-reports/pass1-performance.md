# Phase 5: Performance Report

## Summary
- N+1: 7
- Missing indexes: 4
- Unbounded queries: 4
- CF-specific: 5

Total findings: 20 (capped).

Scope: static analysis of `src/**/*.mjs` request handlers, `src/scheduled.mjs`, `src/extractor.mjs`, `src/audit.mjs`, and cross-referenced `migrations/*.sql` for index coverage. Findings ranked by expected impact at 1K req/sec and realistic data sizes (hundreds of thousands of messages, tens of thousands of conversations).

## Findings

### [PERF-001] FAQ extractor upserts each cluster sequentially [HIGH]
- **File:** src/extractor.mjs:164-185
- **Category:** n_plus_one
- **Impact:** Scheduled weekly and on manual trigger (`/api/faq-candidates/run`). For each distinct question cluster (commonly 200-1000 per week) the loop issues 1 SELECT + 1 UPDATE/INSERT serially. At 500 clusters × ~5ms D1 round-trip each = 2.5s of wall time, well over the 10ms CPU budget — tolerated only because it's a cron, but manual triggers run on the fetch handler path (handlers/faq-candidates.mjs:117). A single manual run can hit the 30s Worker subrequest wall.
- **Fix:** Pre-load existing cluster rows in one query: `SELECT id, status, source_count, answer, cluster_key FROM faq_candidates WHERE tenant_id = ? AND cluster_key IN (...)`. Then build an `env.DB.batch([...])` of UPDATE and INSERT statements. D1 `batch()` pipelines them in a single request, cutting round-trips from 2N to 2 (1 SELECT + 1 batch).

### [PERF-002] Staff import: per-conversation UPDATE inside email loop [HIGH]
- **File:** src/handlers/staff-admin.mjs:177-183
- **Category:** n_plus_one
- **Impact:** `importStaffFromChatwoot` iterates every imported Chatwoot email, and for each email loops every conversation id matched to that email, running one UPDATE per conversation. On the initial import with ~5000 Chatwoot conversations and ~20 assignees, that's 5000 sequential D1 UPDATEs inside a single request. Will blow the 30s subrequest limit and 50ms CPU on paid plan. Also runs a full-table `SELECT id, metadata FROM conversations WHERE metadata LIKE '%chatwoot_assignee_email%'` (line 137) with no tenant filter and no index.
- **Fix:** Replace the inner loop with a single parameterised UPDATE per email: `UPDATE conversations SET assignee_id = ?, updated_at = datetime('now') WHERE id IN (?,?,...) AND assignee_id IS NULL` (or chunk into batches of 50 with `DB.batch()`). Add tenant_id filter on the initial SELECT and consider an expression index on the JSON field if this becomes a recurring import.

### [PERF-003] FAQ candidate bulk action: 1 SELECT + 1 INSERT + 1 UPDATE per id [HIGH]
- **File:** src/handlers/faq-candidates.mjs:97-108
- **Category:** n_plus_one
- **Impact:** Admin bulk approve of 100 candidates runs 3×100 = 300 sequential D1 calls. At typical 4-8ms per call this exceeds the 30s subrequest limit in error cases and routinely blows the 10ms free-tier CPU budget. UI currently allows selecting all pending (limit 500).
- **Fix:** Read all candidates in one `SELECT ... WHERE id IN (...)`, filter pending in-memory, then execute all INSERTs + UPDATEs via a single `env.DB.batch([...])`. Same pattern is safe here because there are no cross-row dependencies.

### [PERF-004] Bot-flow webhook expands every matching var with a sequential SELECT [HIGH]
- **File:** src/handlers/bot-flows.mjs:448-462
- **Category:** n_plus_one
- **Impact:** In the hot path for every customer message that enters a webhook step, the code loops `state.vars` keys matching `/attachment(?:_id)?$/i` and runs one `SELECT * FROM attachments WHERE id = ?` per key. Typical deposit flows have 1-3 attachment vars so the blast is small today, but this runs in `sendMessage` (the 120 rps widget path), and every extra D1 round-trip adds ~5ms to the per-message latency. Free-tier 10ms CPU budget is tight.
- **Fix:** Collect all attachment ids first, then one query: `SELECT id, filename, content_type, size_bytes FROM attachments WHERE id IN (?,?,...)`. Build the attachments map from results. Also consider caching the row inside `state.vars` at upload time to avoid re-fetching at all.

### [PERF-005] Admin menu tree resolves bonus code → flow steps sequentially [MEDIUM]
- **File:** src/handlers/admin-ops.mjs:202-213
- **Category:** n_plus_one
- **Impact:** `adminMenuTree` first fetches the sloten-main flow (one query), then loops `BACKUP_TABLES` (10 tables) in the backup path running `pragma_table_info` + SELECT per table (line 206-214). Admin-only, infrequent — but each admin tab load is 20+ D1 calls when it could be 2.
- **Fix:** For backup: issue all `SELECT * FROM <table>` statements via `DB.batch()` and run the pragma lookups once at module init (the schema doesn't change mid-session). Small win per-call but cuts tail latency from ~200ms to ~30ms.

### [PERF-006] env-resolver calls getEnvValue in a serial loop for every template render [MEDIUM]
- **File:** src/env-resolver.mjs:58-61
- **Category:** n_plus_one
- **Impact:** `resolveEnvForTemplate` loops `OVERRIDABLE_KEYS` (5 keys) calling `getEnvValue` sequentially. First call hits D1 for each uncached key — 5 sequential queries on the hot bot-flow webhook path (`bot-flows.mjs:442`). After the 30s cache warms, all hits are memory reads (OK), but cold-start requests and worker isolate churn give 25-40ms of blocked latency. At 1K rps across isolates the cold-miss rate is non-trivial.
- **Fix:** One query: `SELECT key, value FROM env_overrides WHERE key IN (?,?,?,?,?)`. Populate the cache from the result set and fall back to env[] for misses. Drop the per-key serial calls.

### [PERF-007] AI-logs list: double-fetch pattern with IN (...) rebuild [LOW]
- **File:** src/handlers/ai-logs.mjs:26-41
- **Category:** n_plus_one
- **Impact:** Already uses the 2-query pattern (1 SELECT for logs + 1 aggregate for feedback), which is correct. However at `limit=200` the second query rebuilds a 200-placeholder IN clause every request — still acceptable but noisy. Note: `ai-prompts.mjs:17-26` uses the same correct pattern. No real issue, flagging only to note these are already good.
- **Fix:** No change needed. Listed so reviewers don't mis-flag.

### [PERF-008] conversations.flow_state has no index; DELETE bot_flow full-scans [HIGH]
- **File:** src/handlers/bot-flows.mjs:154-156; migrations/010-bot-flows.sql:28
- **Category:** missing_index
- **Impact:** `deleteBotFlow` runs `UPDATE conversations SET flow_state = NULL WHERE flow_state LIKE '%"flow_id":' || ? || '%'`. On a production conversations table with 100K+ rows this is a full table scan. Additionally, `sendMessage` reads `conv.flow_state` per customer message — this particular read is indexed by conversation id (primary key), so OK — but the admin delete path is the risk. At 100K rows the scan can take seconds.
- **Fix:** Add a partial functional index on flow_state presence — SQLite can't index inside JSON without a generated column. Options: (a) add `flow_id INTEGER` column populated by a trigger / by app code, and `CREATE INDEX idx_conv_flow_id ON conversations(flow_id) WHERE flow_id IS NOT NULL`; (b) don't clear on delete — let `executeFlow` handle missing flow_id as it already does (`bot-flows.mjs:226` clears state when flow not found), which makes the DELETE cleanup redundant and removable.

### [PERF-009] conversations.snoozed_until has no index; cron full-scans every minute [HIGH]
- **File:** src/scheduled.mjs:15-21
- **Category:** missing_index
- **Impact:** Every minute the scheduled handler runs `UPDATE conversations SET snoozed_until = NULL WHERE snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')`. With no index on `snoozed_until`, this is a full scan of the entire conversations table every 60 seconds. At 100K conversations that's millions of rows scanned per day for a handful of updates. Also `listConversations` filters by `snoozed_until IS NOT NULL AND snoozed_until > datetime('now')` (conversations-native.mjs:92) — same scan.
- **Fix:** `CREATE INDEX idx_conv_snoozed ON conversations(snoozed_until) WHERE snoozed_until IS NOT NULL;`. Partial index stays tiny (only snoozed rows) and makes both the cron UPDATE and the staff filter O(log n).

### [PERF-010] staff_members.tenant_id not indexed; export CSV full-scans [MEDIUM]
- **File:** src/handlers/export.mjs:51; migrations/013-staff-auth.sql (no tenant_id index)
- **Category:** missing_index
- **Impact:** staff export query filters by `tenant_id = ?` but only has `idx_staff_email` and `idx_staff_session`. At current single-tenant scale this is fine (tiny table), but if multi-tenant is enabled the scan grows. Low priority since staff tables stay small.
- **Fix:** Optional `CREATE INDEX idx_staff_tenant ON staff_members(tenant_id);` — or accept since cardinality will stay in the hundreds for foreseeable future. Flagging for completeness.

### [PERF-011] audit_log / error_log filter by action LIKE with no prefix index [MEDIUM]
- **File:** src/handlers/admin-ops.mjs:152, 168
- **Category:** missing_index
- **Impact:** `listAuditLog` allows `?action=foo` which becomes `action LIKE 'foo%'`. Existing `idx_audit_tenant` covers (tenant_id, created_at DESC) but not action prefix. At 100K+ audit rows post-launch, LIKE on the un-indexed action column triggers a full scan within the tenant partition. This is an admin-only endpoint but runs synchronously on the request path.
- **Fix:** `CREATE INDEX idx_audit_action ON audit_log(tenant_id, action, created_at DESC);` and similar for error_log(source) which is already partly covered by `idx_error_source`. Double-check column order on existing indexes.

### [PERF-012] /api/export CSV endpoint has no LIMIT at all [CRITICAL]
- **File:** src/handlers/export.mjs:22-57
- **Category:** unbounded
- **Impact:** All export queries (`conversations`, `messages`, `contacts`, `faq`, `templates`, `knowledge`, `staff`, `ai_logs`) have zero row limits. A messages export on a 1M-row table will: (a) exceed D1's 100MB response limit, (b) OOM the Worker (128MB heap), (c) burn CPU building the CSV string in memory. Even with the `since`/`until` filters, an admin can trigger catastrophic memory pressure.
- **Fix:** Add hard cap `LIMIT 100000` to every query; emit a warning header `X-Truncated: true` when the cap is hit. For true bulk export, stream rows via `ReadableStream` + multiple `DB.prepare().all()` calls paginated by `id > last_id LIMIT 10000`, writing chunks to the response body as they arrive. Currently this endpoint is a time bomb.

### [PERF-013] FAQ list endpoint returns ALL rows regardless of size [HIGH]
- **File:** src/handlers/faq.mjs:42-49
- **Category:** unbounded
- **Impact:** `handleFaqGet` runs `SELECT * FROM faq WHERE tenant_id = ? ORDER BY priority DESC, id DESC` with no LIMIT and returns the full result in JSON. The FAQ table grows monotonically via the weekly extractor (approvals) plus manual admin entries. At 10K FAQs × 2KB avg = 20MB response, which blows the Worker response size sweet spot and adds seconds of encode time. Also called on widget load via admin paths.
- **Fix:** Add `LIMIT ?` defaulting to 500, expose via `?limit=` query. If admin UI needs everything, add pagination (`?offset=` or cursor on id). Same pattern applies to `listBotFlows` (bot-flows.mjs:74), `listBotMenus` (bot-menus.mjs:35), `listBonusCodes` (bonus-codes-admin.mjs:32), and `handleKnowledgeSourcesGet` (knowledge-sources.mjs:47) — all return full tables without limits.

### [PERF-014] listStaff / listStaffLookup have no LIMIT [MEDIUM]
- **File:** src/handlers/staff-admin.mjs:24-42
- **Category:** unbounded
- **Impact:** `SELECT * FROM staff_members` with no cap. Staff counts stay small (~100s max) so impact is limited, but the query is on the hot path for operator console load and `listStaffLookup` is called on every message render. Response size grows linearly with operator churn.
- **Fix:** Add `LIMIT 1000` + pagination. Low priority, but the fix is a one-liner.

### [PERF-015] admin backup dump: 10 tables × full reads with 50K-row cap each [MEDIUM]
- **File:** src/handlers/admin-ops.mjs:195-234
- **Category:** unbounded
- **Impact:** Backup reads up to `BACKUP_ROW_LIMIT + 1 = 50001` rows per table × 10 tables = up to 500K rows in a single request, all held in memory as a single JSON blob. Response size can realistically hit 100-300MB, exceeding Worker memory and D1 response caps. Admin-only and infrequent, but a guaranteed outage trigger once real data lands.
- **Fix:** Stream table dumps as NDJSON line-by-line via `ReadableStream` so the whole document never exists in memory at once. Alternative: split into per-table endpoints `/api/admin/backup/:table` so each response stays bounded. Also prefer `SELECT specific_cols` over `SELECT *` to cut payload.

### [PERF-016] audit() and logError() block the response instead of using ctx.waitUntil [HIGH]
- **File:** src/audit.mjs:14-53; callers in src/handlers/admin-ops.mjs, messages-native.mjs
- **Category:** cf_specific
- **Impact:** Every admin action (create/update/delete bonus codes, flows, menus, FAQ, staff, etc.) awaits the audit_log INSERT before returning, adding ~5-10ms D1 round-trip to the response. Same for `logError`. These are fire-and-forget by design (the `catch(() => {})` swallows errors) — they should be dispatched via `ctx.waitUntil` and return immediately. Across hundreds of admin writes/sec the audit writes are single-handedly doubling response latency.
- **Fix:** Change `audit(env, request, ...)` → `audit(env, request, ctx, ...)` and wrap the INSERT: `if (ctx?.waitUntil) ctx.waitUntil(doInsert()); else await doInsert();`. Same for `logError`. Plumb `ctx` through the `requireStaff` / `requireAdminRole` wrappers in index.mjs — they currently drop it.

### [PERF-017] rate-limiter KV read is sequential on every widget POST [MEDIUM]
- **File:** src/rate-limiter.mjs:67-68; src/index.mjs:278
- **Category:** cf_specific
- **Impact:** `checkRateLimit` does `await env.RATE_LIMITER.get(kvKey)` synchronously before handling widget requests. KV reads are ~1-5ms hot, 10-50ms cold. On a 120-req-per-minute widget path this adds up. The put is already `ctx.waitUntil`'d (good), but the get blocks. Worth noting: Durable Object-backed counter (already present as `CONVERSATION_ROOM`) would give sub-ms strong-consistent counting.
- **Fix:** (a) Skip the KV get when the previous counter was below 50% of limit (optimistic path) — track in-isolate; (b) or migrate to a Cache API sliding window; (c) or to a DO counter (strongest). Lowest-effort fix: use `env.RATE_LIMITER.get(kvKey, { cacheTtl: 60 })` to let the CF edge cache reads.

### [PERF-018] sendMessage serial chain: 5+ sequential awaits before response [HIGH]
- **File:** src/handlers/messages-native.mjs:69-294
- **Category:** cf_specific
- **Impact:** Customer message path runs: SELECT conv → SELECT attachment (if any) → INSERT message → UPDATE conversations → SELECT msg (line 49) → broadcastToConversation → then inside the bot branch: SELECT fresh conv → SELECT contact → matchBonusCode (another SELECT) → optional bridge lookup (2 more SELECTs) → runFlowForCustomerMessage (more SELECTs) → generateBotReply. Measured: minimum 8-12 sequential D1 calls per customer message (40-80ms CPU) for a message that enters a bonus-code flow. CPU budget is 10ms free / 50ms paid per request.
- **Fix:** Parallelise independent lookups with `Promise.all`:
  - lines 174-175: load `fresh` conv and `contact` in parallel (currently sequential)
  - line 202-204 + 209: `slotenMain` + `flowRow` lookups can be merged into a single SELECT with JOIN on itself, or loaded in parallel
  - line 91 (attachment check) and line 69 (conv load) are independent and could run in parallel when an attachment_id is present
  Expected savings: 20-30ms off the hot widget path.

### [PERF-019] loadContext regex scans happen inside request handler with no caching [MEDIUM]
- **File:** src/responseFilter.mjs:82-92, 195-229
- **Category:** sync_hot_path
- **Impact:** `filterResponse` walks 9 `PROHIBITED_CATEGORIES` × 1-3 regexes each on every AI response (~20 regex tests). `detectInputThreat` walks 20+ `INJECTION_PATTERNS` against both normalised AND raw input (40+ tests), plus ROT13 + base64 decode attempts. The regex objects are module-level (good — not recompiled), but the `normalizeForInjectionCheck` runs `Object.entries(lookalikes)` → `split/join` 13 times building intermediate strings. On a 300-char message this is ~50µs, acceptable at 1K rps but climbs fast on longer inputs. Also `countPII` in pii-masker.mjs:144-150 rebuilds `new RegExp` from `.source` per call — creates 7 new regex objects each invocation.
- **Fix:** (a) In `countPII`, pre-build the `/g` variants at module scope and reuse; (b) In `normalizeForInjectionCheck` replace the `Object.entries` split/join loop with a single-pass `String.prototype.replace(lookalikeRegex, m => MAP[m])`; (c) Consider a single combined regex per category using `|` alternation rather than N separate tests.

### [PERF-020] bonus_code_submissions update after GAS forward — not indexed by submission id [LOW]
- **File:** src/bonus-codes.mjs:111-113
- **Category:** missing_index
- **Impact:** `UPDATE bonus_code_submissions SET gas_forwarded = 1, gas_response = ? WHERE id = ?` runs after every GAS forward. Uses primary key lookup so this is O(1) — no issue. However the table has 3 indexes (conv, tenant, type) each of which must be updated on every INSERT, which is a tiny write amplification. Flagging to close the loop — no action needed unless INSERT throughput becomes a bottleneck.
- **Fix:** No change needed.

## Top Priority Fixes (if you only do five)

1. **PERF-012** — Add LIMIT to CSV export queries (prevents OOM / time bomb).
2. **PERF-009** — Partial index on `conversations(snoozed_until) WHERE NOT NULL` (kills per-minute full scan).
3. **PERF-016** — Use `ctx.waitUntil` for audit + error logs (frees 5-10ms per admin write).
4. **PERF-001/003** — Convert extractor upserts and faq-candidate bulk actions to `DB.batch()` (fixes N+1 + timeout risk).
5. **PERF-018** — Parallelise the sendMessage hot path with `Promise.all` (20-30ms saved on the widget customer path).
