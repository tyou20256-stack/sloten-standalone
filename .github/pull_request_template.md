# Summary

<!-- One-paragraph description of what changed and why. -->

## Type of change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactor (no functional change)
- [ ] Test/QA improvement

## Pre-merge checklist
- [ ] CI green (Golden Set ≥ 95%, gitleaks, config-drift, bundle-size)
- [ ] Local property tests pass: `node tests/property/*.test.mjs`
- [ ] Database migrations linted: `node scripts/lint-migrations.mjs`
- [ ] Bot flows / menus validated if changed: `node scripts/validate-bot-flows.mjs && node scripts/validate-bot-menus.mjs`
- [ ] No secrets committed (gitleaks job will catch but check locally too)
- [ ] CHANGELOG.md updated if user-visible
- [ ] PROD-CONFIG-DRIFT.md updated if `wrangler.staging-bk.toml` ↔ `wrangler.toml` diverges further

## Test plan
<!-- How was this tested? Include staging-bk Worker version ID if deployed. -->

## Risk assessment
<!--
- LOW: docs / refactor / new test
- MEDIUM: code change without migration, with rollback path
- HIGH: migration / new auth / new external dep
-->

## Rollback plan
<!-- How would we revert if this misbehaves in production? -->
