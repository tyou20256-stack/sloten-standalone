# Failure-mode matrix

Authoritative mapping of every external dependency to its observed failure
mode and current handling in code. Updated 2026-05-13 in response to the
multi-agent architecture audit (concern C8).

When something breaks in production, start here. Every entry includes the
file paths where the dependency is consumed and the strategy applied at
each consumption site.

---

## Cloudflare bindings

### D1 (env.DB)

- **Probe**: `GET /health/db` runs `SELECT COUNT(*) FROM messages WHERE
  created_at > datetime('now','-1 hour')`. Returns 503 on any error.
- **Hot-path failure handling**:
  - Read errors (retrieval, history, contact lookup): caught and treated as
    empty / null; bot still replies but without grounding. See
    `src/retrieval.mjs`, `src/handlers/messages-native.mjs`.
  - Write errors on `INSERT INTO messages` propagate up because the response
    contract depends on the row landing. `sendMessage` returns 500.
  - `recordAiCall` swallows write errors via `doInsertAiLog` — log loss is
    preferable to dropping the user-visible reply.
- **Schedule-job impact**: `scheduled.mjs` wraps every job in try/catch, but
  D1 outage means metrics monitoring + synthetic-uptime probes don't
  record. Telegram alert still fires from independent path.
- **Open gap**: no heartbeat row recording "last successful cron run" — a
  silent D1 outage that pauses metrics is not currently alerted.

### KV (env.RATE_LIMITER / env.STATE_KV / env.SESSION_KV)

- **Probe**: `GET /health/kv` puts/gets/deletes a probe key.
- **Hot-path failure handling**:
  - Rate limiter: `checkRateLimit` returns `allowed: true` on KV read failure
    UNLESS `opts.critical === true` (login uses critical). Audit fix
    2026-05-09 — credential stuffing can no longer bypass via KV outage.
  - Contact-token revocation: `isRevoked` fail-opens on KV error (returns
    `false` = not revoked). Per-isolate negative cache (5s TTL) reduces blast
    radius. Trade-off: revocation propagation lag is bounded; KV outage
    doesn't lock out all widget traffic.
  - Response cache: `respCacheKv.get` failure → falls through to LLM. Safe.
  - Session signing keys: KV is NOT used for verification (HMAC keys live in
    env), so KV outage cannot break staff auth.
- **Open gap**: revocation fail-open is deliberate (uptime > strict
  revocation) but logged as `console.warn`; no alert when sustained.

### R2 (env.FILES)

- **Probe**: `GET /health/r2` lists 1 object.
- **Hot-path failure handling**:
  - Upload failure: `uploadAttachment` returns 5xx with the underlying error.
    Customer's reply text still posts (attachment is optional metadata).
  - Download failure: `downloadAttachment` returns 5xx. Widget retries via
    user click.
- **Open gap**: no automatic retry on transient 5xx from R2.

### Vectorize (env.VECTORIZE)

- **Probe**: `GET /health/vectorize` runs `describe`.
- **Hot-path failure handling**:
  - `vectorizeAvailable()` returns false on probe failure — retrieval falls
    back to FTS5 only. Per-isolate cache (60s TTL since perf-audit fix
    2026-05-13) prevents thundering-herd retry storm.
  - Hybrid RRF path is best-effort; if dense retrieval throws, code falls
    through to FTS5.
  - Reindex (admin operation): batches at 50 vectors/call; per-batch failure
    is reported in the response. No automatic retry.
- **Open gap**: `retrieval_trace` does not currently flag
  `vectorize_unavailable=true` when the probe failed. Would help post-mortem.

### Workers AI (env.AI)

- **Probe**: indirect — used inside `vectorizeAvailable()`; failure cascades
  there.
- **Hot-path failure handling**:
  - bge-m3 embed failure: `vectorizeQueryInternal` throws, `retrievalHybrid`
    catches and returns null, retrieveContext falls through to FTS5.
- **Open gap**: no separate health probe; embed failures only visible in
  retrieval_trace + ai_logs.

### Durable Object — ConversationRoom (env.CONVERSATION_ROOM)

- **Probe**: not exposed directly. WS-upgrade endpoints fail with 503 if
  binding is missing.
- **Hot-path failure handling**:
  - Broadcast: `broadcastToConversation` runs inside `ctx.waitUntil`. Failures
    are swallowed via `.catch(() => {})` — the message persists to D1 either
    way; only real-time push is lost. Widget polls on reconnect.
- **Open gap**: no metric for broadcast failure rate.

---

## External services

### Gemini (GEMINI_API_KEY)

- **Health**: not probed; `/health` only checks the secret is set.
- **Hot-path failure handling**:
  - Retry once with simpler prompt (retrieval.mjs detail).
  - On exhaustion, fall back to Anthropic Haiku if `ANTHROPIC_API_KEY` is set;
    otherwise return canned response and record `status='error'` in ai_logs.
- **Cost throttle**: response cache (KV-backed, audit-verified to not bypass
  context-sensitive paths) shields the API on repeat queries.

### Anthropic (ANTHROPIC_API_KEY) — optional fallback

- **Health**: surfaced via `/version` `has_anthropic_fallback`.
- **Hot-path failure handling**: when invoked as fallback and itself fails,
  ai_logs records `status='error'` and the user gets the canned response.

### Pachi-slot API (PACHI_API_URL, PACHI_API_KEY)

- **Probe**: `GET /health/pachi` proxies upstream `/health` with 4s timeout.
  Returns `binding: 'disabled'` when URL not set (intentional for envs that
  don't use this RAG branch).
- **Hot-path failure handling**:
  - `fetchPachiContext` wraps the upstream call in try/catch; failure means
    no pachi context injected. Bot still replies.
  - `pachiResult.filter_failed` triggers the deterministic canned-response
    bypass (no LLM call) and logs `status='pachi_filter_failed'`.
- **Cost**: KV cache (60s) shields upstream from repeat hits.

### Outbound webhooks (BONUS_CODE_WEBHOOK_URL, GAS_BOT_WEBHOOK_URL,
EC_DEPOSIT_BOT_WEBHOOK_URL, BANK_TRANSFER_BOT_WEBHOOK_URL,
OPERATOR_ATTACHMENT_WEBHOOK_URL)

- **Health**: `/health` reports each as `optional_missing` when unset.
- **Hot-path failure handling**:
  - All outbound webhook calls run inside `ctx.waitUntil` — the customer
    response does NOT block on receiver availability.
  - All outbound webhooks now HMAC-sign with `WEBHOOK_SIGNING_SECRET` (2026-
    05-13 audit fix). Receiver should verify; missing signature → reject.
  - Non-2xx responses: logged as `console.warn`; submission row left with
    `gas_forwarded=0` so retry tooling can scan.
  - 2026-05-13: every outbound webhook also carries `X-Sloten-Trace-Id` so
    incident correlation across systems is mechanical.

### Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) — alerts only

- **Hot-path failure handling**: completely optional. Telegram dispatch is
  fire-and-forget via `ctx.waitUntil`; failures don't surface to users.
- **Open gap**: no escalation when Telegram itself fails — silent (intended;
  alerts are a backup, not authoritative state).

---

## Cross-cutting

### KV signing key rotation

- Old + new key dual-verify pattern (`SESSION_SIGNING_KEY` +
  `STAFF_SESSION_SIGNING_KEY` + `CONTACT_TOKEN_SIGNING_KEY`). `/health` does
  not require all three — `hasAnySigningKey` is the gate.

### Database schema migrations

- `scripts/apply-migrations.mjs` records every applied migration name in
  `_schema_migrations`. The migration body + tracker INSERT now ship as one
  D1 batch (2026-05-13 fix) so partial failure can no longer leave a
  migration applied-but-untracked.

### bot_flows.steps + conversations.flow_state schema

- `flow_state` carries `v: 2` since 2026-05-13. `executeFlow` refuses to
  resume states with unknown versions and drops them — the customer's next
  message re-enters the main menu rather than crashing.

### Trace correlation

- Every request stamps `request.__trace_id` (UUID v4) and:
  - Echoes it in the response via `X-Sloten-Trace-Id` header (CORS-allowed).
  - Forwards it on outbound HMAC-signed webhooks.
- Admin-token callers may supply their own `X-Sloten-Trace-Id` to thread
  external trace context (hex/UUID format validated).

---

## Known unaddressed concerns (tracked for follow-up)

| Concern | Why deferred | Acceptable until |
|---|---|---|
| D1 heartbeat row + alerting | Needs cron design + Telegram template | First multi-tenant SLA |
| Vectorize per-tenant index migration | Premature — only one tenant today | ~50k chunks total OR tenant count > 3 |
| ai-chat-adapter.mjs God-function split | Working code, low churn | Next major feature addition |
| services/repositories three-tier layout | Affects every handler | After current quarter's freeze |
| Full ai_logs trace_id column | Schema change cost > benefit until cross-system audit is needed | Multi-tenant SLA reporting |
