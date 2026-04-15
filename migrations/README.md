# Migrations

Applied in numeric order. Each file should be idempotent where possible.
For a fresh environment, apply `000-schema-bootstrap.sql` (consolidated) OR
all numbered files in order — both produce an equivalent schema.

| File | Description |
|------|-------------|
| 000-schema-bootstrap.sql | **Consolidated golden schema** for fresh deploys. Re-runnable. |
| 001-contacts.sql | `contacts` table + indexes |
| 002-conversations.sql | `conversations` table + indexes |
| 003-messages.sql | `messages` table + indexes |
| 004-conversations-extra.sql | Adds `priority`, `labels`, `snoozed_until` columns + `labels` catalog table |
| 005-external-id.sql | `external_id` UUID alternates for import idempotency |
| 006-external-id-fix.sql | Converts partial UNIQUE to full UNIQUE (fixes ON CONFLICT) |
| 007-ai-logs.sql | `ai_logs` + `ai_log_feedback` |
| 008-teams-prompts.sql | `teams` + `team_members` + `ai_prompts` catalog |
| 010-faq.sql / 011-templates.sql / 012-knowledge.sql / 013-staff-auth.sql | Core content and auth tables |

## Re-running

- Files with `IF NOT EXISTS` / `INSERT OR IGNORE` are re-run safe.
- `ALTER TABLE ADD COLUMN` statements (004/005/008) will error on re-run
  because SQLite lacks `ADD COLUMN IF NOT EXISTS`. Use `000-schema-bootstrap.sql`
  for fresh installs to avoid this entirely.
- `wrangler d1 execute --file=...` treats the whole file as atomic on error —
  a half-applied state is unlikely.

## Applying

```
node scripts/apply-migrations.mjs --remote
```
