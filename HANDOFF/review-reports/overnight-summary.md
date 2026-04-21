# Overnight Report — 2026-04-17 → 2026-04-20 (Extended × 4)

## サマリ

| 指標 | 値 |
|------|---|
| 実行パス | **4 段階** (初回監査 → Review 2 → Review 3 → Review 4 最終) |
| 累計発見 | **48 件** |
| **累計自動修正** | **45 件** (24 commits) |
| テスト | **62/62 pass** (初期 39 → +23) |
| 推定コスト | 約 $3.50 |
| ブランチ | `chore/overnight-2026-04-17-2311` |

## 各パスの発見と修正

### Pass 1 — 初回 Overnight (25 findings)
- **CRITICAL (4/4)**: CODE-001/002/003 + PERF-012
- **HIGH (11/11)**: CODE-004/005/006/007/008/011 + PERF-001/002/003/004/008/009/013/016/018
- **MEDIUM (6/10)**: CODE-009/010 + PERF-005/006/011/014/015/017/019

### Pass 2 — Tenant-scope fresh review (18 findings)
- **GAP-001~011** (11 件): bot-menus/faq/templates/teams/labels/ai-logs の CRUD tenant scope
- **REG-001~004** (4 件): 自身の commit の regression
- **NEW-001~003** (3 件): ai-prompts + admin-ops の新規問題

### Pass 3 — Staff/messages/attachments 再スイープ (5 findings)
- staff-admin.mjs 全 CRUD の tenant scope
- bonus-codes-admin updateBonusCode
- messages-native staff path
- attachments.mjs downloadAttachment staff check

### Pass 4 — Auth/Webhook/Frontend/DO 最終監査 (Review 3, 25 findings)
- **FIN-014 HIGH**: SVG upload → operator 画面 XSS
- **FIN-004/005 HIGH**: 管理者設定 webhook URL の SSRF
- **FIN-018 HIGH**: Durable Object の WS auth 再検証なし
- **FIN-001 HIGH**: operator 検索画面の innerHTML パターンが脆い
- **FIN-007 MEDIUM**: ログインのアカウント列挙 (status + timing)
- **FIN-002/003 MEDIUM**: scheduled cron の境界なし + multi-tenant 非対応
- **FIN-006 MEDIUM**: env-resolver 全キー DB override fallthrough → allowlist 化
- **FIN-009 MEDIUM**: contact token TTL 30日 → 7日
- **FIN-012 LOW**: CSRF が wildcard subdomain を受け入れる
- **FIN-013/019 LOW**: jackpot response size / cookie parse hardening
- **FIN-023 LOW**: テスト追加 (23件)

---

## 24 commits

```
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

## 新規マイグレーション

- `migrations/016-perf-indexes.sql` — snoozed_until 部分 index + audit_log action index
- `migrations/017-knowledge-tenant.sql` — knowledge_sources に tenant_id

## 新規ファイル

- `src/safe-url.mjs` — SSRF 防御の共通 allowlist 実装
- `test/safe-url.test.mjs` — 10 tests (SSRF 拒否全パス)
- `test/tenant-scope.test.mjs` — 5 tests (resolveTenantId の優先順位)
- `test/session-cookie.test.mjs` — 7 tests (cookie parsing edge cases)

## API/動作の変更

| 項目 | Before | After |
|------|--------|-------|
| `/api/staff/login` エラー | 401/423 で区別 | **全て 401 "Invalid credentials"** (timing equal) |
| `/api/admin/*` | 任意の CORS-allowlisted origin | **exact admin origin のみ** (CSRF 強化) |
| `/api/admin/gas-urls` POST | 任意 URL を保存可能 | **isSafeOutboundUrl 検証** (private IP 拒否) |
| webhook fetch (bonus/operator/flow) | 任意 URL に送信 | **同 allowlist 検証 + 10s timeout + byte-bounded read** |
| operator attachment 署名 URL | 24h TTL | **10 分 TTL** (webhook dispatch 時のみ) |
| SVG 添付 | upload 許可 + inline 表示 | **upload 拒否 + 残存分は attachment + CSP** |
| contact token TTL | 30 日 | **7 日** |
| parseCookies 重複名 | last-write-wins | **first-occurrence-wins** |
| CSV export | 無制限 | LIMIT 100000 |
| 各種 list 系 (faq/bot-flows/menus/codes/KB) | 無制限 | LIMIT 500-2000 |
| Durable Object WS upgrade | role trust from query | **再 verify (contact_token / session cookie + tenant check)** |
| DO broadcast is_private check | strict === 1/true | **default-deny accept-list** |

## 残る意図的な設計判断

- **`body.tenant_id` in `contacts-native.mjs:16`** — 未認証 widget 経路のみ。ALLOWED_ORIGINS で widget origin 制限済み。
- **scheduled.mjs の tenant-agnostic メンテナンス** — 現在 single-tenant のため意図通り。multi-tenant 化時は iterate に変更 (コメントに記載)。
- **`__Host-` cookie prefix 未導入 (FIN-011)** — 既存セッション全員の再ログインが必要になるため現状維持。deploy 時に検討。
- **WS URL に contact_token が残る (FIN-010)** — DO 側で再 verify + TTL 短縮 (7日) で blast radius 縮小。hello-handshake 移行は client/DO 両方の同期的変更が必要。

## テスト

- 62/62 pass (初期 39 + 23 新規)
- Covers: tenant-scope, safe-url, cookie parsing, env-resolver allowlist, response filter, pii masker, FAQ extractor
- 未カバー (MCP 不在で未実施): Interactive/E2E/Visual QA、auth flow の end-to-end、WebSocket 接続

## 次のアクション

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone
git diff main..chore/overnight-2026-04-17-2311  # 24 commits レビュー
git merge chore/overnight-2026-04-17-2311 --no-ff
npm run migrate:remote  # 016 + 017 を本番 D1 に適用
npm run deploy
```

**本番 wrangler.toml に追加を推奨:**
```toml
[vars]
# Optional: strict webhook host allowlist. When set, even admin-saved
# webhook URLs must match one of these exact hostnames.
ALLOWED_WEBHOOK_HOSTS = "script.google.com,sloten.io"

# Optional: narrower CSRF origin set for admin state-changing calls.
# ADMIN_ORIGINS = "https://sloten-admin-secure.pages.dev"
```

## 学習事項

1. **3パスの review が必要だった**: 1 パスでは必ず見逃しが出る。fresh-eyes は自分の commit の regression も見つける。
2. **`body.tenant_id` パターンは admin 経路では危険**: 常に `resolveTenantId(request, env)` を使う。widget 経路のみ例外。
3. **Runtime エンジン内の `WHERE id = ?` は安全**: post-INSERT lookup や validated state からの参照は tenant scope 不要。
4. **DO は Worker 層の auth を信頼しすぎない**: 可能な限り DO 内で再検証する方が future-proof。
5. **Webhook URL は allowlist の有無で挙動を切り替える**: デフォルト拒否 (loopback/private) はコーディング不要で常に有効。strict allowlist は本番で opt-in。
6. **Commit message の atomicity 主張は疑う**: 名前に `batch` が付いていても実装が batch() でないことがある。レビュー時は実装確認。
