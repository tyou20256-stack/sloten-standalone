# 01. 現状 (Current Status)

## Git 状態

### main

- Pre-overnight (admin.js 分割 + filter 改善 の snapshot まで)
- 最後の commit: `ab1d04f wip: pre-overnight snapshot (admin.js split + filter improvements)`
- **overnight の変更は含まれていない**

### chore/overnight-2026-04-17-2311 (作業ブランチ)

- `main` から分岐、26 commits 追加
- **本番投入待ち** の状態
- 全 commit が `--no-verify` 不使用 (hook あれば動く)

```bash
# 確認コマンド
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone
git log --oneline main..chore/overnight-2026-04-17-2311 | wc -l   # → 26
git diff main..chore/overnight-2026-04-17-2311 --stat
```

---

## テスト状態

| 種類 | 件数 | 状態 |
|------|------|------|
| Unit (vitest) | **62/62** | ✅ pass |
| ユニット内訳 | extractor(9), pii-masker(6), response-filter(20), env-resolver(6), safe-url(10), tenant-scope(5), session-cookie(6) | 各パス |
| 統合テスト (手動 curl) | 24/24 | ✅ pass (本環境で実施) |
| 付属 smoke (`scripts/dev-smoke.mjs`) | 10/10 | ✅ pass |
| 付属 check (`scripts/check-all.mjs`) | 61 files | ✅ syntax OK |

```bash
# 確認コマンド
npm test                # 62/62 pass
npm run check:all       # 61 files OK
npm run smoke           # wrangler dev が必要 (port 8787)
```

---

## 本番環境状態

- **現行デプロイ**: pre-overnight 版 (admin.js 分割済みの main が上がっている想定)
- **DB**: 本番 D1 にはまだ migration 016/017 未適用
- **Secrets**: `SESSION_SIGNING_KEY`, `ATTACHMENT_SIGNING_KEY`, `GEMINI_API_KEY`, `ADMIN_API_TOKEN` は既存 (確認要)
- **新規 Secret**: `ALLOWED_WEBHOOK_HOSTS`, `ADMIN_ORIGINS` は未設定 (任意、`07-open-questions.md` 参照)

```bash
# 確認コマンド
wrangler deployments list --name sloten-standalone | head -5
wrangler secret list
```

---

## ローカル動作確認手順

### 1. ブランチ取得 + テスト

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone

# ブランチ切り替え
git fetch origin
git checkout chore/overnight-2026-04-17-2311

# 依存インストール + テスト
npm ci
npm test
# 期待: Tests  62 passed (62)
```

### 2. ローカル Worker 起動

```bash
# 開発用 secrets を用意 (git ignore 対象)
cat > .dev.vars <<EOF
SESSION_SIGNING_KEY=dev-session-key-32-bytes-minimum-length
ATTACHMENT_SIGNING_KEY=dev-attachment-key-32-bytes-minimum
ADMIN_API_TOKEN=dev-admin-token
DEFAULT_TENANT_ID=tenant_default
ALLOWED_WEBHOOK_HOSTS=script.google.com,sloten.io
EOF

# マイグレーション local 適用
npm run migrate:local

# Worker 起動 (port 8787)
npm run dev
# or
npx wrangler dev --local --port 8787
```

別ターミナルで:
```bash
# health 確認
curl http://127.0.0.1:8787/health
# 期待: {"status":"ok","db":"ok","kv":"ok",...}

# smoke test
npm run smoke
# 期待: 10 assertions PASS
```

### 3. 個別の動作確認

```bash
# 失敗ログイン (enumeration 防止 = 401 "Invalid credentials")
curl -X POST http://127.0.0.1:8787/api/staff/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://sloten-admin-secure.pages.dev" \
  -d '{"email":"nobody@x.com","password":"wrong"}'

# SSRF allowlist (Bearer admin で localhost 設定 → 400)
curl -X POST http://127.0.0.1:8787/api/admin/gas-urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-admin-token" \
  -d '{"key":"GAS_BOT_WEBHOOK_URL","value":"http://localhost:9999"}'
# 期待: 400 "URL not allowed (loopback, private IP, metadata...)"
```

---

## コード差分の規模

```
26 files changed, 1,200+ insertions(+), 300+ deletions(-)

主な変更ファイル:
  src/handlers/*.mjs                  15 ファイル (tenant scope sweep)
  src/audit.mjs                        ctx.waitUntil 化
  src/env-resolver.mjs                 allowlist + batch query
  src/extractor.mjs                    N+1 → batch
  src/bonus-codes.mjs                  SSRF guard + byte-bounded read
  src/rate-limiter.mjs                 cacheTtl
  src/scheduled.mjs                    LIMIT + multi-tenant note
  src/durable/conversation-room.mjs    WS auth 再検証
  src/auth/*.mjs                       contact token TTL、cookie parse
  src/cors-helper.mjs                  admin origin 分離
  src/index.mjs                        routing + csrfCheckAdmin
  src/safe-url.mjs                     (新規) SSRF 防御
  public/operator/operator.js          検索 UI DOM refactor
  migrations/016-perf-indexes.sql      (新規)
  migrations/017-knowledge-tenant.sql  (新規)
  test/*.test.mjs                      (4 新規 + 1 拡張)
```

---

## マイグレーション 016/017 の中身

### 016-perf-indexes.sql
```sql
CREATE INDEX IF NOT EXISTS idx_conv_snoozed
  ON conversations(snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON audit_log(tenant_id, action, created_at DESC);
```
- 副作用: 小さい (index 追加のみ)
- ロールバック: `DROP INDEX` で可逆

### 017-knowledge-tenant.sql
```sql
ALTER TABLE knowledge_sources
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default';

CREATE INDEX IF NOT EXISTS idx_ks_tenant_active_priority
  ON knowledge_sources(tenant_id, is_active, priority DESC, id DESC);
```
- 副作用: 既存 knowledge_sources 全行に `tenant_id = 'tenant_default'` が backfill (SQLite の仕様)
- ロールバック: SQLite は ADD COLUMN の逆操作がコストが高いので、通常はそのまま残す (新 code は常に `tenant_id = ?` で絞るので後方互換性あり)

---

## 次のアクション

1. **README.md § 最短の引き継ぎ手順** の Step 3 (事前判断) に進む
2. `07-open-questions.md` を読んで 5 項目に回答
3. `02-deploy-runbook.md` に従ってデプロイ
