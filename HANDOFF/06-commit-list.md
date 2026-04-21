# 06. Commit List (26 commits)

各 commit の目的と関連 Finding。`git log main..chore/overnight-2026-04-17-2311` の出力を補足。

---

## 新しい順 (最新 = 最下段が `main`)

| # | Commit | 種別 | 目的 | 関連 Finding |
|---|--------|------|------|------------|
| 26 | `0c6eec1` | fix | dev-smoke に contact_token 対応 (pre-existing bug) | handoff 中発見 |
| 25 | `17d73fd` | docs | 最終 morning report | — |
| 24 | `01b5a17` | security | DO WS 再認証 + login enumeration + operator DOM refactor + 他 | FIN-001/007/017/018/002/013/019 |
| 23 | `93aa5f5` | security | SVG XSS + SSRF allowlist + env-resolver allowlist + attachment TTL | FIN-014/004/005/006 |
| 22 | `420bf83` | docs | 3 パス目 morning report | — |
| 21 | `fccd18d` | security | staff-admin + bonus-codes + messages + attachments の残留 tenant gap | Pass 3 |
| 20 | `e9edca6` | security | ai-prompts/bot-menus/faq/templates/teams/labels/ai-logs の CRUD tenant scope + regression 修正 | Pass 2 |
| 19 | `e106e0b` | docs | 2 パス目 morning report | — |
| 18 | `44204c7` | perf | pii-masker countPII の regex 再生成撤去 | PERF-019 |
| 17 | `7fd6006` | perf | admin backup 並列化 + per-table endpoint + pragma cache | PERF-005/015 |
| 16 | `06f9b66` | perf | env-resolver の 5 serial query を 1 IN query に | PERF-006 |
| 15 | `8376136` | fix | bonus submissions を admin-only + staff LIMIT + KV cacheTtl | CODE-009, PERF-014/017 |
| 14 | `0c5f1db` | perf | sendMessage の conv+contact 並列化 + flow lookup 統合 | PERF-018 |
| 13 | `f684c4e` | perf | bot-flows webhook attachment を IN query に + redundant cleanup 削除 | PERF-004/008 |
| 12 | `2e016e0` | perf | staff import を chunked IN-update に (5000 serial calls → ~20) | PERF-002 |
| 11 | `015bec4` | security | knowledge_sources に tenant_id 追加 + 全 query scope | CODE-002 |
| 10 | `b40f145` | docs | 初回 morning report | — |
| 9 | `964c8ba` | perf | FAQ extractor upsert を 2N → 2 round-trips に | PERF-001 |
| 8 | `311318f` | security | 会話/連絡先/bot_flows 単行 lookup に tenant scope + widget contact 最小化 | CODE-001/005/006/011 |
| 7 | `adb5576` | perf | audit / logError を ctx.waitUntil で非同期化 | PERF-016 |
| 6 | `cc35b59` | perf | snoozed_until 部分 index + audit_log action 複合 index | PERF-009/011 |
| 5 | `ff188ec` | fix | adminTestBot が本番 GAS を誤爆する問題 + cleanup batch 化 | CODE-004 |
| 4 | `e7c5df4` | fix | FAQ candidates: tenant scope + promote の atomicity + bulk batch | CODE-007/010, PERF-003 |
| 3 | `55389e3` | security | AI provider HTTP エラー body を log 前に sanitize | CODE-008 |
| 2 | `da8baf1` | perf | CSV export + admin list に LIMIT (outage risk 除去) | PERF-012/013 |
| 1 | `9b03eb2` | fix | apply-migrations が duplicate column を許容 (idempotent) | CODE-003 |

---

## Commit グルーピング

### グループ A: Initial overnight pass (commits 1-10)
初回自律レビューで発見した 25 件の大半を修正。各コミットは単一テーマに集中。

### グループ B: Tenant scope sweep (commit 11)
knowledge_sources の tenant isolation (CRITICAL)。別コミットにして影響範囲を明示。

### グループ C: 個別修正継続 (commits 12-18)
各 PERF 項目を 1 コミットずつ処理。

### グループ D: Fresh-eyes review 2 (commits 20-21)
1 回目の後に自分の commit を fresh-eyes でレビューして見つかった 11 件 + 4 regression を 2 commit でまとめて修正。

### グループ E: Security audit (commits 23-24)
Auth / webhook / DO 領域の専門監査で見つかった 12 件の HIGH+MEDIUM を 2 commit で修正。
SVG XSS、SSRF allowlist、DO 再認証、login enumeration が含まれる。

### グループ F: Handoff polish (commits 25-26)
引き継ぎのためのドキュメント整備と pre-existing smoke script 修正。

---

## コミット別 diff サマリ (ファイル数)

```
Commit          files changed   +/- lines
──────────────  ─────────────   ──────────
0c6eec1 fix          1            +9/-3   (scripts)
17d73fd docs         1          +96/-79   (report)
01b5a17 security    10          +420/-47  (auth/DO/scheduled/cors/operator.js)
93aa5f5 security    10          +310/-24  (safe-url 新規+handlers+env-resolver)
420bf83 docs         1         +101/-126
fccd18d security     4           +93/-30
e9edca6 security    11          +279/-89
e106e0b docs         1          +122/-90
44204c7 perf         1           +16/-9
7fd6006 perf         2           +72/-30
06f9b66 perf         1           +46/-1
8376136 fix          3           +16/-7
0c5f1db perf         1           +18/-7
f684c4e perf         1           +27/-16
2e016e0 perf         1           +44/-25
015bec4 security     4           +50/-18
b40f145 docs         1          +122/-0
964c8ba perf         1           +54/-19
311318f security     4           +75/-23
adb5576 perf         2           +35/-12
cc35b59 perf         1           +18/-0
ff188ec fix          1           +15/-5
e7c5df4 fix          1           +68/-24
55389e3 security     1           +10/-2
da8baf1 perf         6           +35/-15
9b03eb2 fix          2           +25/-6
```

---

## `git log --oneline` output (コピペ用)

```
0c6eec1 fix(scripts): pass contact_token in dev-smoke so it works post-auth
17d73fd docs: final report (4 review passes, 45 fixes, 25 commits)
01b5a17 security: DO re-auth, login enumeration fix, operator XSS refactor + misc
93aa5f5 security: SVG-XSS, SSRF allowlist, env-resolver allowlist, short URL TTL
420bf83 docs: final morning report (21 commits, 3 review passes)
fccd18d security: complete tenant sweep (staff/bonus/messages/attachments)
e9edca6 security(handlers): fill tenant-isolation gaps across all admin CRUD
e106e0b docs: extended morning report (all 17 findings resolved)
44204c7 perf(pii-masker): reuse module-level regex in countPII
7fd6006 perf(admin): parallel backup + per-table endpoint + cached pragma
06f9b66 perf(env-resolver): batch overridable keys into single IN query
8376136 fix: bonus submissions admin-only + staff LIMIT + KV cacheTtl
0c5f1db perf(messages): parallelize conv+contact + merge flow lookup
f684c4e perf(bot-flows): batch webhook attachment lookup + drop redundant cleanup
2e016e0 perf(staff-admin): chunked IN-update instead of per-conv loop
015bec4 security(knowledge): add tenant_id column + scope every query
b40f145 docs: overnight run state + morning report
964c8ba perf(extractor): batch FAQ candidate upserts
311318f security(handlers): enforce tenant scope on single-row lookups
adb5576 perf(audit): dispatch best-effort writes via ctx.waitUntil
cc35b59 perf(db): add partial index on snoozed_until + audit action composite
ff188ec fix(admin-ops): adminTestBot must not fire real GAS; atomic cleanup
e7c5df4 fix(faq-candidates): tenant scope, idempotent promote, batched bulk
55389e3 security(ai): sanitize provider HTTP error bodies before logging
da8baf1 perf(export,admin): cap unbounded SELECTs with LIMIT
9b03eb2 fix(migrations): tolerate re-apply of non-idempotent ALTER TABLE
```

---

## 詳細を追うには

```bash
# 特定 commit の中身
git show 93aa5f5                      # SVG XSS + SSRF

# ファイル別にどの commit で変わったか
git log main..chore/overnight-2026-04-17-2311 -- src/handlers/messages-native.mjs --oneline

# 統計
git diff main..chore/overnight-2026-04-17-2311 --stat | tail -10
```
