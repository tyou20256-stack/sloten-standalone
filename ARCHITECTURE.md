# ARCHITECTURE (draft)

> Living document. Update as decisions are made.

## Design Principles

1. **Reuse v1.0 AI/KB/templates modules verbatim** — no re-implementation of what already works.
2. **Replace only the Chatwoot layer** — conversation transport, persistence, and operator UI.
3. **Cloudflare-native** — Worker + D1 + KV + Durable Object + R2 + Pages. No external infra.
4. **Progressive rollout** — customers can toggle between v1.0 (Chatwoot) and standalone per-tenant via feature flag.

## Component Map

### Reused from v1.0 (copy or submodule)

- `src/ai-chat-handler.mjs` — AI response generation
- `src/handlers/faq.mjs`, `templates.mjs`, `knowledge-sources.mjs` — CRUD
- `src/auth-helper.mjs`, `src/rate-limiter.mjs` — cross-cutting
- `migrations/` — faq / templates / knowledge_sources / admin schema
- `seeds/` — real-data seeds (templates, KB)
- `public/*` — admin UI (adapted to new endpoints)

### New (standalone-specific)

- `src/handlers/conversations-native.mjs` — create, list, assign, close
- `src/handlers/messages-native.mjs` — send, fetch, mark-read
- `src/durable/conversation-room.mjs` — Durable Object per conversation for real-time fan-out
- `src/widget/` — React chat widget source
- `src/operator-ui/` — operator dashboard (real-time conversation feed)
- `migrations/100-conversations.sql`, `101-messages.sql`, `102-contacts.sql`

## Data Model (draft)

```sql
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,           -- UUID
  tenant_id TEXT NOT NULL,
  email TEXT, phone TEXT, name TEXT,
  metadata JSON,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id),
  status TEXT CHECK(status IN ('bot','open','closed')) DEFAULT 'bot',
  assignee_id INTEGER REFERENCES staff_members(id),
  last_message_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sender_type TEXT CHECK(sender_type IN ('customer','bot','staff')) NOT NULL,
  sender_id TEXT,
  content TEXT,
  content_type TEXT DEFAULT 'text',          -- text, input_select, file
  content_attributes JSON,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Real-Time Delivery

**Durable Object per conversation** — one DO instance owns the conversation's message stream, holds WebSocket connections from customer widget + assigned operator, and broadcasts new messages.

- Customer widget connects to `/ws/conversation/:id`.
- Operator UI connects to `/ws/operator` (hub) for list updates + subscribes to selected conversation.
- Messages persist to D1 before broadcast.

## Migration Path

Tenants on v1.0 → standalone:

1. Dual-write period: Worker receives messages from Chatwoot webhook AND writes to standalone D1 tables.
2. Operator UI toggle lets staff switch between Chatwoot dashboard and standalone UI per-conversation.
3. Once validated, flip feature flag to route new conversations to standalone widget; Chatwoot becomes read-only.
4. After retention period, decommission Chatwoot.

## Open TODOs

- [ ] Auth model for end-customers (anonymous session + optional email verify)
- [ ] File upload path (requires R2 enabled on CF account)
- [ ] Operator notification (browser push? email? Slack webhook?)
- [ ] Analytics / conversation metrics (reuse v1.0 analytics handler + new event stream)
- [ ] Widget theming / branding API
- [ ] SLA timers (reuse v1.0 sla.mjs)
