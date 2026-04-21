# 引き継ぎ資料 — sloten-standalone Overnight 作業

**作業日**: 2026-04-17 ～ 2026-04-20
**ブランチ**: `chore/overnight-2026-04-17-2311` (26 commits, main 未マージ)
**状態**: ✅ **本番投入可 (手動 UI smoke 条件付き)**

---

## 📖 まず読むべき順番 (所要 20 分)

```
README.md (これ、5分)
  ↓
01-status.md (現状把握、3分)
  ↓
04-breaking-changes.md (API 挙動変化、5分)
  ↓
08-gas-urls.md (GAS webhook URL 運用、5分) ← GAS 連携がある場合
  ↓
07-open-questions.md (あなたが判断する項目、2分)
```

以降は必要に応じて:
- デプロイ作業時 → `02-deploy-runbook.md` (手順書、30-45 分で完了)
- 検証内容を確認 → `03-production-readiness.md` (テスト結果)
- 各修正の詳細 → `06-commit-list.md` or `review-reports/`

---

## 🎯 このブランチで何をしたか (1 行要約)

**sloten-standalone を overnight 自動改善で 45 件の修正を適用し、62/62 ユニットテスト + 24/24 統合テストで本番投入可を確認した 26 commits。**

### 修正の内訳

| 種別 | 件数 | 代表例 |
|------|------|--------|
| **セキュリティ (CRITICAL/HIGH)** | 18 | tenant isolation 全 CRUD、SVG XSS 修正、SSRF allowlist、DO WebSocket 再認証、login enumeration 修正 |
| **パフォーマンス** | 15 | N+1 クエリの batch 化、全 list endpoint に LIMIT、snoozed_until 部分 index、ctx.waitUntil 化 |
| **バグ修正** | 8 | admin test bot の本番 GAS 誤爆防止、FAQ promote の atomicity、migration idempotent 化 |
| **コード整理** | 4 | env-resolver allowlist、CORS admin 分離、parseCookies 堅牢化 |

### 新規マイグレーション (本番適用必須)
- `migrations/016-perf-indexes.sql` — snoozed_until + audit_log action index
- `migrations/017-knowledge-tenant.sql` — knowledge_sources.tenant_id カラム

### 新規エンドポイント
- `GET /api/admin/backup/:table` — 大容量テーブル個別 backup

---

## ⚡ 最短の引き継ぎ手順 (セットアップ + デプロイ)

### Step 1: ローカル環境セットアップ (10 分)

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone

# 最新を pull
git fetch origin
git status

# このブランチに切り替えて中身を確認
git checkout chore/overnight-2026-04-17-2311
npm ci
npm test   # ✅ 62/62 pass になることを確認

# 元に戻す (main を触るときはまた切り替える)
git checkout main
```

### Step 2: 変更内容の把握 (15 分)

```bash
# 26 commits のリストを眺める
git log --oneline main..chore/overnight-2026-04-17-2311

# ファイル別の変更量
git diff main..chore/overnight-2026-04-17-2311 --stat

# (時間があれば) 主要な変更の中身
git diff main..chore/overnight-2026-04-17-2311 -- src/handlers/messages-native.mjs
git diff main..chore/overnight-2026-04-17-2311 -- src/safe-url.mjs   # 新ファイル
```

そして **このフォルダの 01-04 を順に読む**。

### Step 3: 事前判断 (10 分)

`07-open-questions.md` の 5 つの判断項目に回答:
1. `ALLOWED_WEBHOOK_HOSTS` を設定するか
2. `ADMIN_ORIGINS` を設定するか
3. `ab1d04f wip: pre-overnight snapshot` をどう扱うか
4. デプロイ時間帯
5. ロールバック判断基準

### Step 4: デプロイ (30-45 分)

`02-deploy-runbook.md` の §1-8 を順に実行。以下が主要手順:

```bash
# a) D1 backup
wrangler d1 export sloten_standalone_db --remote --output=backup-$(date +%Y%m%d).sql

# b) Secret 設定 (ALLOWED_WEBHOOK_HOSTS を設定する場合)
wrangler secret put ALLOWED_WEBHOOK_HOSTS

# c) merge
git checkout main
git merge chore/overnight-2026-04-17-2311 --no-ff
git push origin main

# d) migration 本番適用
npm run migrate:remote

# e) deploy
npm run deploy

# f) 手動 smoke (runbook §8)
# Widget / Operator / Admin の主要動線を人間が触る
```

### Step 5: 24h monitor

Cloudflare dashboard の error rate + latency を監視。
異常時は `02-deploy-runbook.md` §10 の rollback。

---

## 📁 ファイル一覧 (このフォルダ)

| ファイル | 内容 | 読む優先度 |
|---------|------|-----------|
| `README.md` | このファイル | ★★★ (最初に) |
| `01-status.md` | 現状: ブランチ・テスト・本番状態 | ★★★ |
| `02-deploy-runbook.md` | 本番デプロイ手順書 (13 セクション) | ★★★ (デプロイ時) |
| `03-production-readiness.md` | 本番投入可判定レポート | ★★ |
| `04-breaking-changes.md` | API 挙動の破壊的変更一覧 | ★★★ |
| `05-files-changed.md` | 変更ファイル別の内容サマリ | ★ (参照用) |
| `06-commit-list.md` | 26 commits 各 commit の目的 | ★ (参照用) |
| `07-open-questions.md` | あなたが判断する項目 | ★★★ |
| `08-gas-urls.md` | GAS Webhook URL の確認 / 更新手順 | ★★★ (GAS 連携があるなら) |
| `09-gas-v94-deploy.md` | GAS v9.4 (Generic Handler) 適用手順 | ★★★ (GAS 改善を入れるなら) |
| `11-migration-verification.md` | **chatwoot-final-working → sloten-standalone 移植検証結果** | ★★★ (引継前必読) |
| `12-chatwoot-freeze-decision.md` | **chatwoot-final-working 凍結判断 (Option B 採用)** | ★★★ (承認必要) |
| `13-hybrid-dependency-map.md` | **sloten-standalone ↔ GAS 責任分担マップ** | ★★★ (運用必読) |
| `14-gas-update-sop.md` | **PayPay/EC GAS 更新 SOP (標準手順書)** | ★★★ (GAS 更新時) |
| `discussion/` | **自動化戦略 — 6 専門家議論結果 + 統合ロードマップ** | ★★★ (中長期方針) |
| `review-reports/` | 4 パスのレビュー結果 (深掘り用) | ★ (必要なら) |

---

## 🚨 絶対に知っておくべき事項

1. **`main` はまだ overnight の変更を含んでいない** — merge するまで本番には一切影響しない。失敗しても rollback 可能。

2. **26 commits のうち 3 件は docs のみ** — 実質コード変更は 23 commits。

3. **ユニットテストは 62/62 pass** — 初期 39 から 23 件追加 (auth, tenant scope, safe-url)。

4. **ブラウザ UI の実描画は未検証** — Puppeteer MCP が環境になかったため、widget/operator/admin の画面動作はデプロイ直後の手動 smoke で確認する必要がある。

5. **Migration 016/017 は idempotent** — 再実行しても破壊されないが、本番適用は 1 度で OK。

6. **contact token TTL が 30日 → 7日に短縮** — 既発行のトークンは引き続き 30 日間有効 (再発行時点で 7 日)。7 日超離脱したユーザーは再認証 (widget 側の自動再認証が動けば透過)。

7. **「CSRF: admin origin required」で 403 が出たら** — 管理画面の origin が `sloten-admin-secure.pages.dev` 以外 = `ADMIN_ORIGINS` 環境変数設定が必要。

8. **ローカル `.dev.vars` は git ignore 対象** — 手元のみに存在、本番には影響しない。

---

## 🆘 困ったら

| 状況 | 参照 |
|------|------|
| ブランチをローカルで試したい | `01-status.md` § ローカル動作確認 |
| デプロイ手順全体 | `02-deploy-runbook.md` |
| 何が変わったか体系的に知りたい | `04-breaking-changes.md` |
| 具体的なコード変更を追いたい | `05-files-changed.md` + `git log main..` |
| レビューで何を見つけたか | `review-reports/pass*.md` |
| デプロイ失敗時の対処 | `02-deploy-runbook.md` §10 ロールバック |

---

## 📞 本書作成者の意図

このブランチは autonomous overnight セッションで 4 回のレビューパスを通じて作成されました。
各パスで fresh-eyes レビューを行い、自身の commit の regression も発見・修正してあります。

**判断が必要な項目**は `07-open-questions.md` に分離してあります。
**技術的に決着済みの項目**は本文でサラっと説明するだけで OK。

「本番投入可」はテストレベルで確認済みですが、**ブラウザ UI の動作は最終的に人間の目で確認する必要がある** という点だけは必ずカバーしてください。

Good luck!
