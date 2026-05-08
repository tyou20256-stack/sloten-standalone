# sloten-standalone

Standalone (Chatwoot-independent) AI customer support for sloten.io. Cloudflare
Workers + D1 + KV + R2 + Vectorize + Durable Objects.

![Worker](https://img.shields.io/badge/Cloudflare-Workers-orange)
![D1](https://img.shields.io/badge/Cloudflare-D1-blue)
![Tests](https://img.shields.io/badge/property_tests-916_pass-brightgreen)
![Golden Set](https://img.shields.io/badge/Golden_Set-58%2F58_100%25-brightgreen)
![License](https://img.shields.io/badge/license-private-lightgrey)

## Status

**Staging-bk in production-quality, awaiting external blockers** for first
production deploy. See `HANDOFF/11-external-requests.md` for what's blocked.

Latest staging-bk worker: see `/version` endpoint or recent `git log`.

## Quick links

- [`SECURITY.md`](SECURITY.md) — vulnerability reporting
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`docs/PROD-CONFIG-DRIFT.md`](docs/PROD-CONFIG-DRIFT.md) — pre-deploy config gaps
- [`docs/P95-LATENCY-PLAN.md`](docs/P95-LATENCY-PLAN.md) — performance roadmap
- [`docs/AUTO-ROLLBACK.md`](docs/AUTO-ROLLBACK.md) — incident recovery strategy
- [`HANDOFF/`](HANDOFF/) — operational handoffs
- [`tests/`](tests/) — Golden Set + property tests + multi-turn fixtures

## Relationship to `chatwoot-ai-cloudflare`

This repo is a **parallel track**, not a replacement:

| Concern | `chatwoot-ai-cloudflare` (v1.0) | `sloten-standalone` (this repo) |
|---|---|---|
| Chat widget | Chatwoot JS SDK | Self-hosted React/SSE widget |
| Conversation persistence | Chatwoot backend | D1 (own tables) |
| Operator UI | Chatwoot dashboard | Built-in admin (ported from v1.0) |
| AgentBot webhooks | Chatwoot AgentBot | Direct Worker POST |
| AI / KB / templates | Worker + D1 | **Reused verbatim from v1.0** |
| Customer profiles | Chatwoot contacts | D1 (own tables) |

Core AI / KB / templates / admin CRUD is Chatwoot-independent in v1.0, so we can port those modules directly.

## Target Architecture (draft)

```
Customer browser
    └─> /widget (self-hosted React)
         └─> Cloudflare Worker
              ├─> D1: conversations, messages, contacts
              ├─> D1: faq, templates, knowledge_sources (reused)
              ├─> KV: session, rate-limit, jackpot cache
              ├─> AI: Gemini/Anthropic
              └─> Operator UI (Pages) — real-time via Durable Object

Operator
    └─> /admin (Pages)
         └─> Durable Object (conversation rooms) + WebSocket
```

## Open Questions

- WebSocket vs SSE for operator live feed → lean SSE for simplicity
- Durable Object per conversation vs single hub → DO per conversation for isolation
- File upload: R2 (needs account upgrade) vs external (Uploadcare/Cloudinary)
- Authentication for end-users: anonymous sessions only? email/phone verification?

## Next Steps

1. Define conversation/message schema (D1 migration)
2. Port `src/` modules from v1.0 that are Chatwoot-independent (ai-chat, faq, templates, knowledge-sources, rate-limiter, session)
3. Build widget (React + SSE)
4. Build operator UI (real-time conversation list + message stream)
5. Migrate admin CRUD from v1.0

## License

Private — BK Stock / Sloten.
