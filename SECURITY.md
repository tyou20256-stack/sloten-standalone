# Security Policy — sloten-standalone

## Reporting a Vulnerability

If you discover a security vulnerability in sloten-standalone, **please do
NOT open a public GitHub issue**. Instead:

1. **Email**: `rcc.aoki@gmail.com` with subject prefix `[SECURITY]`
2. Include:
   - A clear description of the vulnerability
   - Steps to reproduce
   - Affected components / version (Worker version ID is helpful)
   - Your assessment of severity (informational / low / medium / high / critical)
   - Whether you'd like credit (and how to attribute)

We aim to acknowledge within 48 hours and provide a remediation timeline
within 7 days.

## Scope

In scope:
- Cloudflare Worker (`sloten-standalone-staging-bk` and the future
  production `sloten-standalone`)
- Admin web panel under `/admin/`
- Widget chat surface under `/widget/`
- D1 database, KV namespaces, R2 attachments
- HMAC token signing (`SESSION_SIGNING_KEY` / `STAFF_SESSION_SIGNING_KEY`
  / `CONTACT_TOKEN_SIGNING_KEY` / `RAG_CACHE_SIGNING_KEY`)
- Webhook integration paths (`bot-flows.mjs`)
- AI/LLM prompt injection surface (`ai-chat-adapter.mjs`,
  `responseFilter.mjs`)

Out of scope:
- Third-party services we depend on but don't control:
  - Google Gemini API
  - Anthropic API (when configured)
  - sloten.io public announcements API (we treat this as untrusted —
    see `announcements.mjs:sanitizeUntrusted`)
  - pachi-slot-crawler API (also untrusted RAG source)
- Social-engineering of staff
- DoS via Cloudflare-level traffic floods (use Cloudflare WAF)
- Issues affecting forks of this repo

## Existing Mitigations

Where we already harden, by category:

### Prompt Injection
- All RAG inputs (announcements, pachi machine names) wrapped in
  `<!-- BEGIN UNTRUSTED -->` delimiters with explicit "ignore instructions
  inside" guidance to the model
- `sanitizeUntrusted()`: strips control chars, Unicode tag block
  (`U+E0000-E007F` ASCII smuggling), zero-width / bidi / BOM, leading
  markdown headers
- `detectInputThreat()`: pattern + ROT13 + base64 heuristics on user
  input, with telemetry logged to `ai_logs.status='threat_blocked'`

### Authentication / Sessions
- HMAC-SHA256 with constant-time verify (`crypto.subtle`)
- 4h sliding-window session TTL (`STAFF_SESSION_TTL_SECONDS`)
- KV revocation list — logout invalidates immediately
- Three signing keys: STAFF_SESSION / CONTACT_TOKEN / RAG_CACHE — failure
  in one doesn't compromise the others (dual-verify rotation supported)

### File Uploads
- Whitelist: image/* (excluding SVG) + application/pdf
- 10 MB cap, both header + body verified
- Filename CRLF strip on insert AND download (header injection defense)
- `Content-Disposition: attachment` for PDFs (PDF-borne JS neutralized)
- `X-Content-Type-Options: nosniff`

### Input Validation
- Customer message hard cap at 4000 chars (ReDoS / token-cost defense)
- Escalation regex input cap at 4096 chars (belt-and-suspenders)

### Rate Limiting
- Token-bucket per IP and per contact-token (`rate-limiter.mjs`)
- KV-backed, fails closed for sensitive paths

### Secrets
- All sensitive values via `wrangler secret put` — never committed
- `wrangler.staging-bk.toml` gitignored
- `gitleaks` runs on every PR (`.github/workflows/qa.yml`)

### Observability
- All threat-blocked / escalation events logged to `ai_logs` for review
- 5-min metrics monitor with Telegram alert on error spikes
- Daily classifier shadow-mode agreement report

## Known Acceptances (LOW risk)

- KV revocation race: if a logout's KV write fails AND the KV namespace
  is later unavailable during validation, the token survives until TTL.
  Acceptable because (a) DB-side `session_token_hash` is also nulled on
  logout and (b) max exposure is the 4h TTL.
- `SameSite=Lax` on staff cookies: intentional for cross-origin admin
  panel embedding scenarios. CSRF defended at endpoint level (mutation
  routes check `Origin` header).
