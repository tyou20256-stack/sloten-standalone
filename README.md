# sloten-standalone

Standalone (Chatwoot-independent) version of the Sloten AI Customer Support system.

## Status

**Planning / skeleton.** Implementation starts after the v1.0 Chatwoot-dependent deliverable is handed off.

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
