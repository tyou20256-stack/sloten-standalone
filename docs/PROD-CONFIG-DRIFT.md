# Production wrangler.toml Drift — Pre-Deploy Checklist

> 2026-05-08 / 2026-05-09 構造修正完了
> `node scripts/check-config-drift.mjs` で発見された差分
> 本番初回デプロイ前に **必ず解消** すること
>
> ## ✅ 2026-05-09 解消ステータス
>
> wrangler.toml の構造修正は完了 (cron / vars 2 / R2 / Vectorize bindings 追加)。
> drift check **0 件** で CI は `continue-on-error` 削除済 → ハード fail。
>
> ### 残作業 (本番初回デプロイ時)
> - [ ] R2 バケット `sloten-standalone-files` を本番アカウントに作成
> - [ ] Vectorize index `sloten-kb-index-prod` を本番アカウントに作成
> - [ ] D1 / KV の REPLACE_WITH_*_ID プレースホルダーを実 ID に置換
> - [ ] secret 全 provisioning + 段階デプロイ

## 検出ドリフト 4 件 (履歴)

`wrangler.toml` (prod 本体) と `wrangler.staging-bk.toml` (staging-bk) を比較:

### 1. cron triggers — prod に weekly FAQ 抽出 cron が無い
- **prod**: `crons = ["* * * * *"]` (毎分のみ)
- **staging-bk**: `crons = ["* * * * *", "0 18 * * SUN"]` (毎分 + 週次)

`scheduled.mjs` の FAQ 抽出は週次トリガー必須。本番で抜けると週次集計が一切走らない。

**修正**:
```toml
[triggers]
crons = [
  "* * * * *",         # every minute: snooze wake / metrics
  "0 18 * * SUN",      # weekly: Sunday 18:00 UTC — FAQ extraction
]
```

### 2. vars — `PUBLIC_WORKER_URL` / `PACHI_API_URL` が prod に無い
- staging-bk のみ:
  - `PUBLIC_WORKER_URL` — 添付ファイル signed URL に使用
  - `PACHI_API_URL` — pachi-rag の Cloudflare Tunnel エンドポイント

prod デプロイ時にこれら無いと:
- 添付 URL が壊れる (`signAttachmentUrl` 未定義 baseUrl)
- pachi-rag が完全に動作不能 (callPachiAPI が `env.PACHI_API_URL` 未定義で skip)

**修正** (本番値に置き換え):
```toml
[vars]
ENVIRONMENT = "production"
DEFAULT_TENANT_ID = "tenant_default"
AI_PROVIDER = "gemini"
PUBLIC_WORKER_URL = "https://sloten-standalone.rcc-aoki.workers.dev"  # adjust
PACHI_API_URL = "https://pachi-api.bkpay.app"                         # same as staging
```

### 3. R2 binding — prod に `FILES` バケット定義無し
- **staging-bk**: `[[r2_buckets]] binding = "FILES"`
- **prod**: 無し

`attachments.mjs` の R2 操作 (`env.FILES.put/get`) が全て `503 R2 not configured` で失敗する。

**修正**:
```toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "sloten-standalone-files"  # 本番用バケット作成必要
```

事前作業: `npx wrangler r2 bucket create sloten-standalone-files`

### 4. Vectorize binding — prod に未定義
- **staging-bk**: `[[vectorize]] binding = "VECTORIZE"`
- **prod**: 無し

Phase 2b の dense retrieval (vectorize ベース) が prod で完全に無効化される。FTS5 fallback で動作はするが品質低下。

**修正**:
```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "sloten-kb-index-prod"  # adjust
```

事前作業: `npx wrangler vectorize create sloten-kb-index-prod --dimensions=1024 --metric=cosine`

## CI への組み込み

`scripts/check-config-drift.mjs` を `.github/workflows/qa.yml` に追加することを推奨:
```yaml
- name: Check config drift
  run: node scripts/check-config-drift.mjs
```

これで PR 時にドリフト発生をブロックできる (現在は手動実行のみ)。

## 推奨デプロイ前チェックリスト

- [ ] R2 バケット `sloten-standalone-files` を本番アカウントに作成
- [ ] Vectorize index `sloten-kb-index-prod` を本番アカウントに作成
- [ ] `wrangler.toml` に上記 4 項目を追加
- [ ] `node scripts/check-config-drift.mjs` で 0 ドリフトを確認
- [ ] D1 migration `migrations/*.sql` を prod DB に適用
- [ ] `wrangler secret put` で本番 secret 全 provisioning (rotate-signing-keys.ps1)
- [ ] `npx wrangler deploy` (config drift 0 確認後)
