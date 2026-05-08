# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/).
Versioning is staging-bk worker IDs (until production deploy establishes semver).

## [Unreleased] — 2026-05-08 (post-eval round 2)

### Added
- Anthropic Haiku fallback when Gemini exhausts 5xx retries
  (transparent provider switch, logged in `retrieval_trace.provider_fallback`)
- Per-binding deep health endpoints: `/health/db`, `/health/kv`,
  `/health/r2`, `/health/vectorize`, `/health/pachi`
- Daily synthetic uptime probe (00:10 UTC) — end-to-end AI chat smoke
  test, Telegram alert on degradation
- Weekly D1 `ANALYZE` (Sunday 18:00 UTC) — query planner refresh
- Property tests: rate-limiter (9/9), sanitize/text-classify (31/31),
  escalation FP (840 cases / 0 FP), soak.js fallback (11/11)
- `CHANGELOG.md` — git log derived

### Operational
- Cache invalidation admin endpoints (`/api/admin/cache/{flush,flush-faq,stats}`)
- Config drift detector (`scripts/check-config-drift.mjs`) — found 4
  prod-side gaps documented in `docs/PROD-CONFIG-DRIFT.md`
- Bundle size CI check
- gitleaks secret scanning in CI

## [a8e391c] — 2026-05-08

### Added
- `/health` env validation with critical/optional missing breakdown
- `SECURITY.md` — vulnerability reporting policy
- `scripts/analytics/{slow-queries,audit-review}.sql` — ops dashboards
- Property tests for sanitize functions
- Cache invalidation admin endpoints

### Documentation
- `docs/PROD-CONFIG-DRIFT.md` — 4 real prod-side config gaps detected

## [4c2e1a7] — 2026-05-08

### Added
- Gemini response KV cache (15min TTL, hash-keyed) — p95 plan #5
- Dynamic RAG reduction for short queries (FAQ 5 / KB 3) — p95 plan #2
- Daily classifier shadow agreement report (handlers/classifier-report.mjs)
- Negative-path canary CI workflow (verifies 95% gate actually rejects 80%)
- Property tests for escalation FP (840 benign queries / 0 FP)
- Negative test entries to Golden Set (g-063〜g-067, 58/58 PASS)

### Changed
- Session/contact-token HMAC unified via `lib/crypto.mjs:importHmacKey`
- Escalation regex input length cap (4096 chars) — ReDoS belt-and-suspenders

## [9fa5a48] — 2026-05-08

### Security
- pachi RAG primary path: `sanitizeUntrusted` full coverage (H6 fix)
- announcements: HMAC-SHA256 KV cache integrity + dual-verify rotation
- attachments: SVG MIME block, PDF Content-Disposition: attachment
- session: 4h sliding TTL + KV revocation, signing key tri-split

### AI/RAG
- intent-classifier (shadow mode): 6-category routing
- pachi: NON_MACHINE_KATAKANA_BLACKLIST, isKnownMachine + probe ladder
- announcements: period-keyword scoring, 5×500-char cap
- ai-chat-adapter: dynamic FAQ exclusion, finish_reason retry,
  Gemini 5xx retry with exponential backoff
- escalation: Frustration patterns, numeric-yen refund, deadloop fix

### Tests
- Golden Set: 50 → 53 entries, 100% PASS, runner with retry
- Multi-turn fixtures: 5 scenarios, 5/5 PASS
- k6 soak.js: substring fallback for JSON.parse failures
- CI: `.github/workflows/qa.yml` (Golden Set 95% gate + gitleaks)

## [ee58ec1] — 2026-05-07

### Added (P-1〜P-9 sprint)
- P-1: Session TTL 12h→4h sliding + revocation list
- P-2: SESSION_SIGNING_KEY 用途別分離 (3 keys + dual-verify)
- P-3: Golden Set 評価フレームワーク (50 entries, 95% threshold)
- P-4: pachi-rag blacklist → 機種名正例反転 (`/api/exists` integration)
- P-5: classifyIntent() shadow mode (Step 1)
- P-6: 管理画面 T4 調査 (curl-based independent verification)
- P-7: k6 soak test (50 VUs × 30min)
- P-8: Monitoring + Telegram alerts (5min cron, threshold-based)
- P-9: Playwright v3-final (31/33 PASS)

## Earlier history

See `git log --oneline` for prior commits. Major milestones:
- 2026-04-15: project bifurcation into v1.0 (Chatwoot) and standalone tracks
- 2026-04-22: Phase 1+2a+2b AI accuracy improvements
- 2026-04-30: 13 chatbot fixes from operations feedback
- 2026-05-02: pachi-slot-crawler integration (machine spec RAG)
- 2026-05-05: announcements live RAG (sloten.io API)
