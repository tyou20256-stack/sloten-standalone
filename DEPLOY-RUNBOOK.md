# Sloten-standalone 本番デプロイ手順

**ブランチ**: `chore/overnight-2026-04-17-2311`
**変更規模**: 25 commits、修正 45 件、テスト 39 → 62
**作業時間目安**: 30-45 分 (検証含む)
**想定ダウンタイム**: ゼロ (Cloudflare Workers + D1 の特性上)

---

## 0. 作業前提

- 作業者: 本番 `wrangler` 認証済み、D1 書込権限あり
- ロールバック可能な状態: 現在の `main` の直近 commit (pre-overnight snapshot `ab1d04f`) に戻せる
- 本番アクセス経路: `wrangler.toml` に定義された Cloudflare account + zone
- バックアップ: 直近の D1 export が存在する (なければ §3 でまず取得)

---

## 1. 事前確認 (Pre-flight)

### 1.1 ブランチ取込のレビュー

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone

# 25 commit を 1 つずつ確認
git log --oneline main..chore/overnight-2026-04-17-2311

# ファイル別 diff を review
git diff main..chore/overnight-2026-04-17-2311 --stat
git diff main..chore/overnight-2026-04-17-2311 -- src/handlers/
git diff main..chore/overnight-2026-04-17-2311 -- migrations/
```

### 1.2 テスト確認

```bash
# worktree で実行
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone-overnight-2026-04-17-2311
npm ci            # lockfile 確認
npm test          # 62/62 pass 期待
```

### 1.3 `wip: pre-overnight snapshot` をどうするか決定

`main` には `ab1d04f wip: pre-overnight snapshot` (admin.js 分割 + filter 改善) が 乗っている。以下のいずれか:

- **(推奨) そのまま残す**: 履歴として明確。merge commit と合わせて overnight 作業の塊がわかる
- **(整理派) squash**: `git rebase -i` で `wip` と overnight の commit を整形

本書は前者を前提。

---

## 2. Breaking Changes (要周知・要フロント同期)

デプロイ前に運用チーム・フロント担当に共有すべき API 挙動の変化。

### 2.1 認可・CSRF の厳格化

| Endpoint | 変化 | 影響 |
|----------|------|------|
| `/api/bonus-code-submissions` GET | `requireStaff` → `requireAdminRole` | **非 admin staff は 403**。運用上これを閲覧する必要があるスタッフには admin ロールを付与 |
| `/api/admin/*` 状態変更 | CSRF: CORS allowlist → **exact admin origin のみ** | 管理画面を `sloten-admin-secure.pages.dev` 以外から操作している場合は `ADMIN_ORIGINS` 環境変数に追加 (§4) |
| `/api/widget/conversations/:id` GET | `contact` 全フィールド → **`{id, name}` のみ** | 既存の widget JS が `email/phone/metadata` を読んでいる場合は動作変化。本リポの widget.js は問題なし (確認済) |

### 2.2 ログイン挙動の統一

| 旧 | 新 |
|---|---|
| 404 `Not found` / 401 `Invalid credentials` / 423 `Account locked` | **全て 401 `Invalid credentials`** |

- 監視が 423 を特別扱いしている場合は 401 に切替
- 「アカウントロック中」という具体的なエラーはもうユーザーに見せない (enumeration 防止)

### 2.3 入力サイズ・LIMIT

| Endpoint | 変化 |
|----------|------|
| `/api/export/:resource` | **LIMIT 100000 + X-Truncated ヘッダ** 。大量 export は `X-Truncated: true` で切り捨て通知 |
| `/api/faq`, `/bot_flows`, `/bot-menus`, `/bonus-codes`, `/knowledge-sources` GET | LIMIT 500-2000 。UI 側で pagination を想定していない場合は次の運用判断 |
| `/api/admin/backup` | 並列化 + 個別 `/api/admin/backup/:table` 追加。従来の全件 backup も動作する |

### 2.4 添付ファイル

| 変化 | 影響 |
|------|------|
| **SVG upload 不可** | カスタマー/スタッフとも `.svg` を送るとエラー。既存の SVG ファイルは attachment として配信 (inline 禁止) |
| `Content-Security-Policy: default-src 'none'; sandbox` が全 attachment 応答に付く | SVG が万が一残っていても XSS 化しない |
| webhook 送信の添付 signed URL TTL 24h → **10 分** | GAS 側が遅延受信している場合は 10 分以内の処理に要確認 |

### 2.5 POST body の `tenant_id` 無視

次のエンドポイントは `body.tenant_id` を**無視** し、セッションから解決。既存クライアントが送っていても動作するが、別テナントを指定しても反映されない:
- `/api/faq` POST
- `/api/templates` POST
- `/api/teams` POST
- `/api/labels` POST
- `/api/ai-prompts` POST
- `PUT` 系の `tenant_id` フィールドは `FAQ_COLS` / `TPL_COLS` から除外 (更新不可)

### 2.6 Widget contact token TTL

- 30日 → **7日**
- 既存トークンは従来通り 30日まで有効 (再発行時に 7日に)
- 7日以上 widget に触れないユーザーは再ログインが必要 (widget 側の自動再認証が動くなら透過的)

### 2.7 Webhook URL 厳格検証

- 管理画面から保存する Webhook URL に以下の制約:
  - HTTP(s) のみ
  - loopback / RFC-1918 / 169.254 (IMDS) / CGNAT / IPv6 ULA / `*.internal` / `*.local` は**拒否**
  - `env.ALLOWED_WEBHOOK_HOSTS` 設定時は exact host match 必須

---

## 3. バックアップ (必須)

本番デプロイ前に D1 backup を取得。マイグレーション失敗時のロールバック素材。

### 3.1 D1 export

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone
DB_NAME=sloten_standalone_db  # wrangler.toml の database_name
DATE=$(date +%Y%m%d-%H%M)

# Export to .sql
wrangler d1 export $DB_NAME --remote --output=./backup-$DATE.sql

# サイズ確認
ls -la backup-$DATE.sql
```

### 3.2 R2 / 手元にコピー

```bash
# (任意) R2 バケットがあれば
wrangler r2 object put <backup-bucket>/backup-$DATE.sql --file=backup-$DATE.sql

# 少なくとも 2 箇所 (ローカル + クラウド) に保持
```

### 3.3 現行 deployment の version を控える

```bash
wrangler deployments list --name sloten-standalone 2>&1 | head -5
# 現在の deployment-id をメモ (ロールバック時に必要)
```

---

## 4. 環境変数 / シークレット (任意だが推奨)

### 4.1 `ALLOWED_WEBHOOK_HOSTS` (推奨)

管理者が保存した webhook URL を exact-host allowlist で更に制限。`env_overrides` が悪用されても被害を限定。

```bash
wrangler secret put ALLOWED_WEBHOOK_HOSTS
# 値: script.google.com,sloten.io
# (必要な GAS ドメインと自社ドメインのみをカンマ区切り)
```

### 4.2 `ADMIN_ORIGINS` (任意)

管理画面の origin を増やしたい場合。デフォルトは `sloten-admin-secure.pages.dev` のみ。

```bash
wrangler secret put ADMIN_ORIGINS
# 値: https://sloten-admin-secure.pages.dev,https://admin.example.com
```

※ 設定しなければデフォルトのみ許可される。

### 4.3 確認

```bash
wrangler secret list
# 期待: ANTHROPIC_API_KEY, GEMINI_API_KEY, SESSION_SIGNING_KEY,
#       ATTACHMENT_SIGNING_KEY, ADMIN_API_TOKEN,
#       + 新: ALLOWED_WEBHOOK_HOSTS, ADMIN_ORIGINS (optional)
```

---

## 5. ブランチ取込

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone

# main にマージ (no-ff で履歴を明確に)
git checkout main
git pull origin main
git merge chore/overnight-2026-04-17-2311 --no-ff -m "merge: overnight security & perf pass (25 commits, 45 fixes)"

# 念のため最終テスト
npm ci
npm test   # 62/62 pass

# push
git push origin main
```

---

## 6. マイグレーション適用 (デプロイより**先**)

Workers デプロイより先にマイグレーションを走らせる。新 code が存在しない古い DB に当たっても無害 (追加のみ)。

### 6.1 ローカル検証 (推奨)

```bash
# まずローカル D1 で再実行の安全性を確認
npm run migrate:local 2>&1 | tail -20

# 期待: 016-perf-indexes.sql -> OK
#       017-knowledge-tenant.sql -> OK
# 2 回目実行で "SKIP (already applied: ...)" が出れば idempotent OK
npm run migrate:local 2>&1 | tail -5
```

### 6.2 本番適用

```bash
npm run migrate:remote 2>&1 | tail -30

# 期待: 既存 migration は SKIP、016/017 のみ OK
# 失敗時:
#   - 016-perf-indexes.sql: CREATE INDEX IF NOT EXISTS のみ → 安全、再実行可
#   - 017-knowledge-tenant.sql: ALTER TABLE ADD COLUMN tenant_id → duplicate エラーは script 側で SKIP
```

### 6.3 schema 確認

```bash
wrangler d1 execute sloten_standalone_db --remote --command="PRAGMA table_info(knowledge_sources);"
# tenant_id 列が存在すること

wrangler d1 execute sloten_standalone_db --remote --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%snoozed%';"
# idx_conv_snoozed が存在すること

wrangler d1 execute sloten_standalone_db --remote --command="SELECT COUNT(*) AS n, MIN(tenant_id) AS t FROM knowledge_sources;"
# すべて tenant_id='tenant_default' で backfill されていること
```

---

## 7. Workers デプロイ

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone

# build check
node --check src/index.mjs

# deploy
npm run deploy 2>&1 | tee deploy-$(date +%Y%m%d-%H%M).log

# 期待出力: "Uploaded sloten-standalone (X sec)" + new version ID
# version ID をメモ (§10 ロールバック時に使用)
```

### 7.1 health check (Worker 起動確認)

```bash
# /health は DB ping も含む
curl -s https://<your-worker-domain>/health | jq .
# 期待: {"status":"ok","db":"ok","kv":"ok",...}
```

---

## 8. デプロイ後検証 (Smoke test — 手動必須)

MCP が無い環境で automated E2E が走っていないため、ここは **必ず人間が触る**。

### 8.1 Widget 経路

チェックリスト:
- [ ] Widget 初期化 (初回挨拶、menu 表示)
- [ ] Bonus code 入力 → 成功メッセージ
- [ ] Deposit flow (bank transfer / paypay) → ステップ遷移 → GAS webhook 到達
- [ ] 画像 attachment upload → staff 側でプレビュー
- [ ] **SVG upload → 400 エラー (拒否)** ←新仕様
- [ ] 再読み込み → conversation 継続 (contact_token)

### 8.2 Operator console

- [ ] ログイン (正しい credentials) → セッション開始
- [ ] ログイン (誤 credentials) → **401 `Invalid credentials`** ←新仕様 (423 は出ない)
- [ ] 会話リスト表示、検索
- [ ] **検索結果の表示が崩れていない** ←FIN-001 DOM refactor
- [ ] メッセージ送信、private note 送信 → customer 側に private note が**漏れていない**
- [ ] WebSocket 接続 (DevTools Network → WS frame)

### 8.3 Admin console

- [ ] ログイン、各セクション (FAQ / bot-flows / bonus-codes / knowledge / staff / teams / labels) の一覧表示
- [ ] 各セクション CRUD 動作
- [ ] **別テナントID を body で指定しても自分のテナントで保存される** ←tenant_id injection 対策
- [ ] GAS URL 設定画面から **localhost / 192.168.x.x を保存しようとすると 400 エラー** ←FIN-004
- [ ] Backup 生成、個別テーブル backup (`/api/admin/backup/:table`) が動く
- [ ] CSV export の `X-Truncated` ヘッダ確認 (大量データがあれば)

### 8.4 AI チャット

- [ ] 顧客メッセージ → bot reply (Gemini 経由)
- [ ] FAQ / KB context が system prompt に含まれる
- [ ] Prompt injection 試行 (`ignore previous instructions`) → `detectInputThreat` でブロック
- [ ] エラーログに provider raw body が**切り詰められている** ←CODE-008

### 8.5 スケジュール cron

- [ ] 1 分後にログで `[scheduled]` の出力確認 (snooze wake or 何もない)
- [ ] snooze 設定した会話が時刻到来後に `open` に戻る

### 8.6 監視

- [ ] Cloudflare dashboard で error rate < 通常値
- [ ] D1 query duration が悪化していない (indexes の効果を確認)
- [ ] R2 attachments の取得が動作

---

## 9. 動作確認 SQL (任意)

```bash
# マルチテナント isolation が効いているかの抜き打ち
wrangler d1 execute sloten_standalone_db --remote --command="
  SELECT 'faq' t, COUNT(DISTINCT tenant_id) n FROM faq
  UNION ALL SELECT 'knowledge_sources', COUNT(DISTINCT tenant_id) FROM knowledge_sources
  UNION ALL SELECT 'bot_flows', COUNT(DISTINCT tenant_id) FROM bot_flows
  UNION ALL SELECT 'staff_members', COUNT(DISTINCT tenant_id) FROM staff_members;
"
# 単一テナントなら全て n=1 (tenant_default)
```

---

## 10. ロールバック手順

### 10.1 Workers ロールバック (即時、60 秒以内)

```bash
# 直前の deployment にロールバック
wrangler rollback --name sloten-standalone
# or 特定 version ID 指定
wrangler rollback --name sloten-standalone --version-id <old-deployment-id>
```

### 10.2 マイグレーションは基本 "戻さない"

- 016-perf-indexes.sql: 追加 index のみ → 新 code が動かなくなっても DB は壊れない
- 017-knowledge-tenant.sql: `tenant_id` 列追加のみ → 旧 code は列を無視できる

それでも戻す必要があれば:

```bash
# 緊急時のみ
wrangler d1 execute sloten_standalone_db --remote --command="DROP INDEX IF EXISTS idx_conv_snoozed;"
wrangler d1 execute sloten_standalone_db --remote --command="DROP INDEX IF EXISTS idx_audit_action;"
wrangler d1 execute sloten_standalone_db --remote --command="DROP INDEX IF EXISTS idx_ks_tenant_active_priority;"
# tenant_id カラム削除は SQLite だと大仕事なので通常不要
```

### 10.3 D1 データリストア (最悪ケース)

```bash
# 3.1 で取得した backup-YYYYMMDD-HHMM.sql から復元
wrangler d1 execute sloten_standalone_db --remote --file=backup-YYYYMMDD-HHMM.sql
# 直前の状態に完全復元 (overnight 以降の本番データ変更は失われる)
```

### 10.4 Git ロールバック

```bash
# main を pre-overnight に戻す
git reset --hard ab1d04f  # wip: pre-overnight snapshot
git push --force-with-lease origin main  # 事前に他の push がないこと確認
```

※ force push 前にチームに通知。

---

## 11. デプロイ後 24h モニタリング項目

Cloudflare dashboard または Grafana で以下を確認:

| 指標 | 閾値 | 異常時のアクション |
|------|------|-------------------|
| Worker invocations / sec | 通常 ±20% | 急減: ルーティング壊れた可能性 → rollback |
| Worker errors / sec | 通常 +50% 以内 | 急増: 新 code 問題 → logs 確認、rollback |
| D1 query p95 latency | 通常 ±20% | 悪化: index 効いていない可能性 (稀) |
| 4xx 率 (特に 401/403) | ベースライン+30% 以内 | 急増: CSRF 強化で既存 UI が蹴られている可能性 → `ADMIN_ORIGINS` 確認 |
| Widget 接続率 | 通常値 | 低下: contact_token 7d TTL で旧トークン expire 多発の可能性 |
| GAS forward 成功率 | 通常値 | 低下: `ALLOWED_WEBHOOK_HOSTS` の設定忘れで弾かれている可能性 |

---

## 12. 後日 TODO (将来対応)

デプロイ後の改善項目 (今回スコープ外):

- **FIN-010 contact_token を WebSocket URL から hello handshake に移行** (widget.js + DO の同期改修)
- **FIN-011 `__Host-sloten_staff_session` cookie prefix に rename** (既存セッション全員 invalidate が必要)
- **FIN-023 追加テスト**: auth flow e2e、bonus code、flow engine step transitions
- **Puppeteer MCP を整備してから Phase 3/4/9 (interactive / design / E2E regression) を実施**
- **Multi-tenant 対応**: `scheduled.mjs` のテナントイテレーション、`contacts-native.mjs` の widget tenant 取得を CORS origin から推定

---

## 13. 緊急連絡先

- Cloudflare account: (記入)
- wrangler 認証者: (記入)
- GAS オーナー (bonus / deposit webhook): (記入)
- オンコール Slack channel: (記入)

---

## 付録 A: ファイル別変更サマリ

### 新規 (8 ファイル)
- `src/safe-url.mjs` — SSRF 防御
- `migrations/016-perf-indexes.sql`
- `migrations/017-knowledge-tenant.sql`
- `test/safe-url.test.mjs`
- `test/tenant-scope.test.mjs`
- `test/session-cookie.test.mjs`
- `test/env-resolver.test.mjs` (拡張)
- `src/handlers/admin-ops.mjs` `adminBackupOneTable` (新 endpoint)

### 主要修正 (Worker)
- `src/index.mjs` — `csrfCheckAdmin`、admin-route の CSRF 強化、DO `request.__ctx` 伝搬
- `src/audit.mjs` — `ctx.waitUntil` 化、`logError(request)` 受取
- `src/env-resolver.mjs` — OVERRIDABLE_KEYS allowlist 化、batch IN-query
- `src/extractor.mjs` — FAQ 抽出を batch()
- `src/bonus-codes.mjs` — SSRF 検証 + byte-bounded read
- `src/rate-limiter.mjs` — `cacheTtl`
- `src/responseFilter.mjs` — (触らず)
- `src/scheduled.mjs` — snooze LIMIT、multi-tenant コメント
- `src/durable/conversation-room.mjs` — WS 認証再検証、broadcast defensive check
- `src/auth/contact-token.mjs` — TTL 7d
- `src/auth/attachment-signature.mjs` — ttlSeconds 引数優先
- `src/auth/session.mjs` — parseCookies first-wins、malformed % 安全化
- `src/cors-helper.mjs` — `isAdminOrigin`
- `src/handlers/*` — tenant-scope sweep (15+ ハンドラー)

### 主要修正 (Frontend)
- `public/admin/admin-core.js` + `public/admin/sections/*.js` — 既存 (split from admin.js)
- `public/operator/operator.js` — 検索 UI を DOM refactor (FIN-001)

---

## 付録 B: コミットリスト (25 件)

```
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

**作成日**: 2026-04-20
**作成者**: overnight セッション (Review 1-4)
**承認**: (記入)

---

## Appendix: Signing Key Rotation (P-2)

**背景**: `SESSION_SIGNING_KEY` が staff session / contact token / RAG cache HMAC の 3 用途で共用されていた。用途別に分離してリスクを限定化。

### 移行手順

1. **コードデプロイ** (済 — Worker `90bf6662`): デュアル検証コードが入った状態。新 key 未設定時は旧 key にフォールバック。
2. **新 key provisioning**:
   ```powershell
   cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
   .\scripts\rotate-signing-keys.ps1
   ```
   staging-bk に 3 つの新 secret が設定される。
3. **本番適用** (要 CS チーム周知):
   `rotate-signing-keys.ps1` の production セクションのコメントを外して実行。
4. **デュアル検証期間** (14 日):
   - 新規トークンは新 key で署名される
   - 旧トークン (旧 key 署名) はデュアル検証で引き続き有効
   - wrangler tail で移行進捗を監視:
     ```bash
     npx wrangler tail --format pretty | grep "legacy SESSION_SIGNING_KEY"
     ```
5. **14 日後** (旧トークン全失効後):
   - `npx wrangler secret delete SESSION_SIGNING_KEY`
   - session.mjs / contact-token.mjs / announcements.mjs からフォールバックコードを削除

### 新 Secret 名

| Secret | 用途 | ファイル |
|---|---|---|
| `STAFF_SESSION_SIGNING_KEY` | スタッフセッション HMAC | `src/auth/session.mjs` |
| `CONTACT_TOKEN_SIGNING_KEY` | Widget contact token HMAC | `src/auth/contact-token.mjs` |
| `RAG_CACHE_SIGNING_KEY` | お知らせ KV cache HMAC | `src/handlers/announcements.mjs` |
