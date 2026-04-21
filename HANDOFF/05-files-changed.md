# 05. 変更ファイル一覧と変更内容

**合計**: 新規 10 + 既存変更 26 = **36 ファイル**

---

## 新規ファイル (10)

| ファイル | 目的 | 関連 Finding |
|---------|------|------------|
| `src/safe-url.mjs` | SSRF 防御の共通関数 `isSafeOutboundUrl()` | FIN-004/005 |
| `src/handlers/admin-ops.mjs` に `adminBackupOneTable` 追加 | 大容量テーブル個別 backup endpoint | PERF-015 |
| `migrations/016-perf-indexes.sql` | snoozed_until + audit_log action index | PERF-009/011 |
| `migrations/017-knowledge-tenant.sql` | knowledge_sources.tenant_id カラム | CODE-002 |
| `test/env-resolver.test.mjs` | env-resolver テスト (拡張) | FIN-006 |
| `test/safe-url.test.mjs` | isSafeOutboundUrl テスト 10 件 | FIN-004/005 |
| `test/tenant-scope.test.mjs` | resolveTenantId テスト 5 件 | tenant priority |
| `test/session-cookie.test.mjs` | parseCookies テスト 6 件 | FIN-019 |
| `.dev.vars` (ローカル、gitignore 対象) | 開発用シークレット — 本番には影響なし | — |
| 各種 HANDOFF/*.md | 本引き継ぎ資料 | — |

---

## Worker 本体 (`src/`)

### `src/index.mjs` — ルーティング本体

| 変更 | 内容 | 関連 |
|------|------|------|
| `request.__ctx` 伝搬 | audit/logError が ctx.waitUntil 使えるように | PERF-016 |
| `csrfCheckAdmin` 関数追加 | admin routes に厳格 CSRF | FIN-012 |
| `requireAdminRole` 内で `csrfCheckAdmin` 使用 | 管理操作の CSRF 強化 | FIN-012 |
| `/api/admin/backup/:table` route 追加 | per-table backup | PERF-015 |
| `/api/bonus-code-submissions` を `requireAdminRole` に変更 | email leak 防止 | CODE-009 |
| `/api/widget/conversations/:id` で `source: 'widget'` を渡す | contact 最小化 | CODE-011 |

### `src/audit.mjs` — 監査ログ + エラーログ

- `ctx.waitUntil` で非同期化 (5-10ms/request 短縮)
- `logError(env, source, err, context, request)` — 5 番目の引数で request を受取り、`__ctx` にアクセス可能に
- 関連: PERF-016 / FIN-REG-004

### `src/env-resolver.mjs` — 環境変数解決 + DB override

- `OVERRIDABLE_KEYS` に無いキーは DB 参照をスキップ (`SESSION_SIGNING_KEY` 等を allowlist 外に)
- `resolveEnvForTemplate` を cache-first + 1回の IN query に変更 (5→1 DB calls)
- 関連: FIN-006 / PERF-006

### `src/extractor.mjs` — 週次 FAQ 抽出

- 2N 回の serial D1 round-trip → **1 SELECT + 1 batch()** に
- 関連: PERF-001

### `src/bonus-codes.mjs` — ボーナスコード runtime

- `forwardToGas` で `isSafeOutboundUrl` 検証
- fetch に 10 秒 timeout
- `readBounded(response, 4000)` で response body のバイト数制限
- 関連: FIN-004

### `src/rate-limiter.mjs` — レートリミッタ

- KV read に `{ cacheTtl: 60 }` で CF edge cache を有効化
- 関連: PERF-017

### `src/scheduled.mjs` — Cron ハンドラ

- snooze-wake UPDATE に `LIMIT 500` の subquery guard
- multi-tenant 非対応の意図的コメント追加
- 関連: FIN-002/003

### `src/responseFilter.mjs` — AI 出力フィルタ

- (今回不変、pii-masker と一緒に review のみ)

### `src/pii-masker.mjs` — PII マスキング

- `countPII` 内の regex 毎回再生成を撤去 (module-level 配列で reuse)
- 関連: PERF-019

### `src/durable/conversation-room.mjs` — Durable Object

- `#handleUpgrade` で WS upgrade 時に contact_token / session cookie を**再検証**
- operator は staff.tenant_id と conversation.tenant_id が一致することをクロスチェック
- `#broadcast` で `is_private` 判定を default-deny accept-list に変更
- 関連: FIN-017/018

### `src/auth/contact-token.mjs` — Widget 認証トークン

- `TTL_SEC = 30*24*3600` → `7*24*3600` (30日 → 7日)
- 関連: FIN-009

### `src/auth/attachment-signature.mjs` — 添付ファイル署名 URL

- `signAttachmentUrl(env, id, baseUrl, ttlSeconds)` — ttlSeconds 引数の優先順位を修正 (env.ATTACHMENT_URL_TTL_SECONDS より優先)
- 関連: FIN-005

### `src/auth/session.mjs` — スタッフセッション

- `parseCookies` を first-occurrence-wins に変更
- malformed % エンコードを swallow (throw しない)
- 関連: FIN-019

### `src/cors-helper.mjs` — CORS ヘッダ生成

- `ADMIN_ORIGINS` 定数と `isAdminOrigin()` 関数追加
- env.ADMIN_ORIGINS で追加可
- 関連: FIN-012

### `src/tenant-scope.mjs` — テナント解決

- **変更なし** (tests 新規追加のみ)

---

## Handlers (`src/handlers/`)

### 全体パターン

tenant_id scope の大規模 sweep。全 CRUD ハンドラで:
1. `resolveTenantId(request, env)` を呼ぶ
2. SELECT / UPDATE / DELETE の WHERE に `AND tenant_id = ?` 追加
3. ownership 事前チェックで 404 判定を厳格化

### 個別ファイル

| ファイル | 主な変更 |
|---------|----------|
| `admin-ops.mjs` | adminTestBot の GAS 誤爆防止 + cleanup batch化、backup 並列化 + per-table endpoint、setGasUrl/pingGasUrl に `isSafeOutboundUrl` |
| `ai-logs.mjs` | getAiLog / deleteAiLog に tenant scope、aiStats thumbs を JOIN-scoped に |
| `ai-prompts.mjs` | createPrompt の `body.tenant_id` injection 修正、update/delete に tenant scope |
| `attachments.mjs` | SVG MIME + ext 拒否、downloadAttachment に CSP/attachment header、staff path に tenant-JOIN check |
| `bonus-codes-admin.mjs` | updateBonusCode の tenant scope、submissions を admin-only |
| `bot-flows.mjs` | listBotFlows LIMIT、updateBotFlow/deleteBotFlow tenant scope、webhook step に isSafeOutboundUrl、webhook step の attachment lookup を IN query に、deleteBotFlow の flow_state cleanup を tenant-scoped json_extract に |
| `bot-menus.mjs` | listBotMenus LIMIT、updateBotMenu/deleteBotMenu tenant scope |
| `contacts-native.mjs` | getContact / listContactConversations tenant scope |
| `conversations-native.mjs` | getConversation/updateConversation/markRead tenant scope、widget 経路で contact 最小化 |
| `export.mjs` | LIMIT 100000 + X-Truncated / X-Row-Count header、knowledge を tenant scoped に |
| `faq.mjs` | GET/PUT/DELETE tenant scope、FAQ_COLS から tenant_id 除外、POST で body.tenant_id 無視 |
| `faq-candidates.mjs` | updateCandidate/approve/reject/bulkAction 全て tenant scope、promoteOne の冪等化 (409 on concurrent)、bulkAction を batch() に |
| `knowledge-sources.mjs` | 全 CRUD に tenant scope |
| `labels.mjs` | create/update/delete tenant scope、deleteLabel の conversations UPDATE を tenant-scoped に (cross-tenant mutation 防止) |
| `messages-native.mjs` | sendMessage 中の conv+contact 並列化、slotenMain クエリ統合、sendMessage/listMessages staff path に tenant scope、OPERATOR_ATTACHMENT_WEBHOOK_URL に isSafeOutboundUrl + 10 分 TTL |
| `public-jackpot.mjs` | fetch response に 100k バイトキャップ |
| `staff-admin.mjs` | createStaff/updateStaff/deleteStaff/resetStaffPassword 全て tenant scope、email 一意性も tenant 内、importStaffFromChatwoot を chunked IN query に |
| `staff-auth.mjs` | loginHandler で enumeration 防止 (401 統一 + dummy verifyPassword で timing equal) |
| `teams.mjs` | createTeam の body.tenant_id 無視、全 CRUD tenant scope、addTeamMember/removeTeamMember で team+staff 両方の tenant 検証、deleteTeam を batch() atomic に |
| `templates.mjs` | 全 CRUD tenant scope、TPL_COLS から tenant_id 除外 |

---

## Frontend (`public/`)

### `public/operator/operator.js`

- 検索結果の `el({html:...})` template を DOM node + textNode に置換
- 関連: FIN-001 (regression risk 回避)

### `public/admin/admin-core.js` + `public/admin/sections/*.js`

- **変更なし** (pre-overnight で既に分割済み)

### `public/widget/widget.js`

- **今回のブランチでは変更なし** (pre-overnight WIP に含まれる内容のみ)

---

## Migrations (`migrations/`)

| ファイル | 変更 |
|---------|------|
| `010-bot-flows.sql` | `ALTER TABLE conversations ADD COLUMN flow_state` が非 idempotent である旨のコメント追加 |
| **016-perf-indexes.sql** | 新規: snoozed_until 部分 index + audit_log action index |
| **017-knowledge-tenant.sql** | 新規: knowledge_sources.tenant_id カラム + 複合 index |

---

## Scripts (`scripts/`)

### `scripts/apply-migrations.mjs`

- stderr が "duplicate column name" / "already exists" / "UNIQUE constraint failed" を含む場合は **SKIP** 扱いに (idempotent 化)
- 関連: CODE-003

### `scripts/dev-smoke.mjs`

- contact_token を取得して X-Sloten-Contact-Token として送るように修正 (pre-existing bug)
- 関連: handoff 作業中に発見

---

## Tests (`test/`)

| ファイル | 内容 | 件数 |
|---------|------|------|
| `env-resolver.test.mjs` | 既存 + `ignores DB override for non-overridable keys` | 6 |
| `extractor.test.mjs` | 既存 | 9 |
| `pii-masker.test.mjs` | 既存 | 6 |
| `response-filter.test.mjs` | 既存 | 20 |
| **`safe-url.test.mjs`** | 新規 | 10 |
| **`tenant-scope.test.mjs`** | 新規 | 5 |
| **`session-cookie.test.mjs`** | 新規 | 6 |

**合計**: 62 tests (初期 39 から +23)

---

## Documentation (`/`)

| ファイル | 目的 |
|---------|------|
| `OVERNIGHT-REPORT.md` | 4 パスの総括 (worktree の .overnight-state/morning-report.md をミラー) |
| `DEPLOY-RUNBOOK.md` | 本番デプロイ手順書 |
| `PRODUCTION-READINESS.md` | 検証テスト結果 |
| `HANDOFF/*.md` | 本引き継ぎ資料 |
