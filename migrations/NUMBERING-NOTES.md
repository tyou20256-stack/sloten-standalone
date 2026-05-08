# Migration Numbering Notes

## Detected duplicates (intentional or legacy)

`scripts/check-migrations.mjs` flags the following — keep this note current
when resolving:

| Version | Files | Status |
|---|---|---|
| 010 | `010-bot-flows.sql`, `010-faq.sql` | Both legitimately applied — different tables, no conflict in SQL |
| 011 | `011-attachments.sql`, `011-templates.sql` | Same — independent tables |
| 012 | `012-faq-candidates.sql`, `012-knowledge.sql` | Same — independent tables |

D1 migrations table tracks by **filename**, so duplicate version prefixes
do not cause replay conflicts. The audit script warning is informational.

## Detected gap

`015 → 018` (016, 017 missing). These slot numbers were reserved for
work-in-progress branches that never landed. Acceptable.

## Going-forward policy

For new migrations:

1. Use the next sequential 3-digit prefix (currently `025-...`).
2. Avoid duplicate prefixes — the audit script is set to warn, but it
   makes manual review of "what's in this version" harder.
3. Backfill numbering only via NEW migrations (never rename a deployed
   migration — D1 tracks by exact filename).
