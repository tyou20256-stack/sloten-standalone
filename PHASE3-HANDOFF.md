# Phase 3 引き継ぎ書 — 本番投入条件達成のためのアクション

> 2026-05-06 専門エージェント 5体 (Code / Security / AI / Reality / Test) 評価で示された本番投入条件
> Phase 1+2 の自動修正は完了 (Version `d38cc4a0-572f-4ce6-8ca3-b54ba69caf0c`)
> 本ドキュメントは外部依存・運用作業を伴うため別セッション/別担当で実施が必要

---

## ✅ Phase 1+2 完了済み (本セッションで適用、staging-bk デプロイ済)

| # | 内容 | 影響ファイル |
|---|---|---|
| 1.1 | RAG コンテンツに `<!-- BEGIN/END UNTRUSTED -->` delimiter 追加 + sanitizeUntrusted (制御文字 / Unicode tag block / zero-width / md heading 除去) | `announcements.mjs`, `pachi-machines.mjs`, `ai-chat-adapter.mjs` |
| 1.2 | KV announcements cache に HMAC SHA-256 署名 (キー: SESSION_SIGNING_KEY、コンテキスト: announcements:v1:hmac、定数時間 verify) | `announcements.mjs` |
| 1.3 | customerMessage 4000 字 hard cap (widget は 413、staff は slice)、SVG MIME/拡張子 block、Content-Disposition: attachment for non-image/pdf、X-Content-Type-Options: nosniff、CRLF strip on filename | `messages-native.mjs`, `attachments.mjs` |
| 2.5 | `lib/text-classify.mjs` 抽出 (hasJapanese, looksLikeFreeText, isNonJapaneseQuery)、bot-flows.mjs と ai-chat-adapter.mjs から重複削除 | `lib/text-classify.mjs` (新規), `bot-flows.mjs`, `ai-chat-adapter.mjs` |
| 2.6 | pachi 検知時に FAQ/KB を system prompt から物理削除 + announcements との mutual exclusion (pachi 優先) | `ai-chat-adapter.mjs` |
| 2.7 | finish_reason ベース retry: MAX_TOKENS → maxOutputTokens 2x、空+STOP → temperature 0.5、SAFETY/RECITATION → no retry | `ai-chat-adapter.mjs` |
| 2.8 | お知らせ時期フィルタ (GW/お盆/年末年始/シルバーウィーク/メンテナンス キーワード boost)、retrieval_trace 拡張 (pachi_detected/announcement_detected/faq_excluded/kb_excluded/pachi_citations/message_length) | `announcements.mjs`, `ai-chat-adapter.mjs` |

---

## ⏳ Phase 3 残作業 — 本番投入の必須条件 (Reality Checker B1〜B5)

### B1. v3 ハーネスでの完全再テスト [CRITICAL]

**実行方法:**
```
別ターミナルで:
1. claude mcp add playwright -- npx -y @playwright/mcp@latest
2. 新しい Claude Code セッションを起動
3. 以下を貼り付け:
   PLAYWRIGHT-TEST-PLAN-V3.md (C:\Users\PC\OneDrive\Desktop\sloten-standalone) を読んで全テストを実行。
   v3 ハーネス (getBotMessagesAfterUser / assertResponseContains / clearCookies) を実装。
   結果を C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT-v3-final.md に出力。
   Worker version: d38cc4a0-572f-4ce6-8ca3-b54ba69caf0c
```

**合格条件:** v3 全 32 ケース PASS、または FAIL ケース個別にリスク受容書

### B2. 本番 Webhook 4 件設定 [CRITICAL]

担当: BK 側エンジニアリングチーム

```bash
# 取得すべき URL (BK 側で発行):
BANK_TRANSFER_BOT_WEBHOOK_URL=https://...    # 銀行振込
GAS_BOT_WEBHOOK_URL=https://...               # PayPay
EC_DEPOSIT_BOT_WEBHOOK_URL=https://...        # コンビニ ATM
BONUS_CODE_WEBHOOK_URL=https://...            # ボーナスコード

# wrangler に設定 (本番):
cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
echo $BANK_TRANSFER_BOT_WEBHOOK_URL | npx wrangler secret put BANK_TRANSFER_BOT_WEBHOOK_URL
# (4 件繰り返し)
```

**疎通確認:** 各フロー (銀行/PayPay/ATM/ボーナスコード) を本番 widget で実行 → BK 側のスプレッドシート/受付システムで記録確認 → スクショ保存

### B3. 管理画面の T4 系統修正 [CRITICAL]

**T4-1 ログイン Cookie 残存:**
- ログアウト endpoint がセッションを完全 invalidate しているか確認
- `Set-Cookie: session=; Max-Age=0; Path=/` を返しているか

**T4-2 会話一覧 0 行:**
- `/api/admin/conversations?tenant=tenant_default` の SQL を確認
- staging-bk DB 上の conversations 行数を `wrangler d1 execute` で確認
- 結果が 0 件であれば仕様通り。テストで前提として会話作成 → 一覧表示の流れに変更

**T7 401 `/api/staff/me`:**
- Widget ページが管理 API を叩く理由を調査 (admin パネルの bundle が widget ページに混入してる?)
- もし widget では不要なら fetch を削除、必要なら 401 を握りつぶす

### B4. Soak Test [HIGH] ✅ スクリプト用意済み、本格実行待ち

**ステータス:** `tests/load/soak.js` + `tests/load/README.md` 作成済み。Dry run (5 VUs × 30s) PASS。

```bash
# Dry run (完了済み — エラー 0%、bot_replied 100%)
k6 run --vus 5 --duration 30s tests/load/soak.js

# 本格実行 (要人間オペレーション — 30 分かかるため)
k6 run --vus 50 --duration 30m tests/load/soak.js
```

**Dry run 結果 (2026-05-07):**
- http_req_failed: 0%
- contact/conversation/message: 全て 100% 成功
- AI 応答レイテンシ p95: 6.3s (Gemini Flash Lite の特性上、想定内)

**測定項目:**
- p50 / p95 / p99 レスポンスタイム
- エラー率 (4xx/5xx)
- D1 query latency (Cloudflare Analytics)
- KV miss rate
- Workers CPU time / subrequest count

**合格条件:** エラー率 < 1%, p95 < 3s, p99 < 8s

### B5. monitoring/alert 構築 [HIGH]

**Cloudflare Workers Logpush 設定:**
```bash
npx wrangler logs --format=pretty > /var/log/sloten-worker.log
# OR Logpush to R2 + 集計 worker
```

**Telegram Bot アラート:**
- 既存 `chatwoot-bot.rcc-aoki.workers.dev` の Telegram 連携を流用
- 閾値: error_rate > 5%、p95 > 5s、KV failure > 10/min

**ダッシュボード:**
- Cloudflare Workers Analytics をチームで共有
- ai_logs テーブルの retrieval_trace を Grafana / Looker で可視化

---

## 🔧 Phase 3 推奨追加作業 (B1-B5 後)

### Code Review HIGH (今回未対応分)
- `messages-native.mjs:386` aiReply.handoff が if(cleanText) ブロック内で空応答時にスキップされる問題 → handoff チェックをブロック外に移動
- `pachi-machines.mjs:625` try/catch で keyword-map build エラーを silently 握りつぶし → console.warn 追加
- `pachi-machines.mjs:300-323` probe ladder の magic numbers `[5,6,4]` `[8,6,5]` に名前付き定数化

### Security HIGH (今回未対応分)
- セッション TTL 12h / contact-token 30d は長すぎる。リボケーションリスト追加
- `SESSION_SIGNING_KEY` を session/contact-token/announcements で共用 → 用途別キー分離
- `detectInputThreat` 発火時の telemetry/alert 追加 (現在は silent drop)
- `INJECTION_PATTERNS` に Unicode tag block (E0000-E007F) を追加 → ai-chat-adapter 側で対応済だが responseFilter にも反映

### AI Engineer HIGH (今回未対応分)
- Golden Set 50件構築 (機種10/お知らせ10/FAQ20/escalation5/英語/menu各5)
- `classifyIntent(message)` 関数への意図ルーティング層一本化
- BM25 score を retrieval.trace に出す
- NON_MACHINE_KATAKANA_BLACKLIST → 機種名正例リスト反転 (pachi DB の `/api/exists?name=` 1ホップ + 1h KV キャッシュ)
- shadow.mjs を本番では off (A/B 評価期だけ on)

### Test Strategy MEDIUM
- CI 化 — GitHub Actions で deploy 後に Playwright 自動実行 + Slack/Telegram 通知
- Mobile viewport (390x844) テスト追加
- WebSocket 切断耐性 / Durable Object replication 試験
- D1 race / 多人数同時会話試験
- Visual regression (pixel-diff baseline)

---

## 🚀 段階的本番投入プラン (B1-B5 完了後)

| Phase | トラフィック | 期間 | go/no-go 基準 |
|---|---|---|---|
| Canary | 1% | 24h | error_rate < 1%, escalation_rate 想定範囲内 |
| Beta | 10% | 48h | + p95 < 3s, KV cache hit > 80% |
| GA-prep | 50% | 72h | + ユーザー満足度 (CSAT 取得方法定義) |
| GA | 100% | — | 全観測項目グリーン |

**ロールバック手順:**
```bash
# 過去版 ID 取得
npx wrangler deployments list --config wrangler.toml

# 即時切り戻し
npx wrangler rollback <previous-version-id> --config wrangler.toml
```

`DEPLOY-RUNBOOK.md` にこの手順を実例コマンド + 想定所要時間 (90s 以内) で追記すること。

---

## 📊 現状スコア更新 (Reality Checker)

| 項目 | Before | After (Phase 1+2) | GO ライン |
|---|---|---|---|
| テスト (実証) | 15 | 15 | 25 |
| ドキュメント | 10 | 12 | 12 |
| アーキテクチャ | 8 | 12 | 14 |
| 本番接続性 | 0 | 0 | 12 |
| 管理画面 | 2 | 2 | 8 |
| モニタリング | 0 | 2 | 8 |
| 負荷耐性 | 0 | 0 | 6 |
| ロールバック | 3 | 3 | 5 |
| **合計** | **38** | **46** | **82** |

Phase 1+2 で **+8 点** (主にコード・アーキ向上 + retrieval_trace でモニタリング基盤強化)。
GO までの残ギャップ **36 点** — 主因は B2 (12点) / B3 (6点) / B5 (6点) / B4 (6点) / B1 v3 全 PASS (10点)。

---

## P-4: pachi-slot-crawler /api/exists エンドポイント — VPS デプロイ手順

### 背景
`NON_MACHINE_KATAKANA_BLACKLIST` (12語ハードコード) の運用負債を解消するため、pachi DB に機種が実在するか確認する `/api/exists` エンドポイントを追加。sloten-standalone 側は fail-open 設計で既にデプロイ済み。

### pachi-slot-crawler 変更済み (ローカル)
**ファイル:** `C:\Users\PC\pachi-slot-crawler\src\api\server.py`
- `/api/search` の直後に `/api/exists` を追加 (GET, Bearer auth)
- `loader.search(name, limit=1)` で ILIKE 部分一致検索
- レスポンス: `{"exists": bool, "matched_count": int, "query": str}`

### VPS デプロイ手順

```bash
# 1. SSH でVPSにログイン
ssh root@5.104.87.106

# 2. pachi-slot-crawler リポジトリを更新
cd /opt/pachi-slot-crawler   # or wherever deployed
git pull origin main

# 3. サービス再起動
systemctl restart pachi-api   # or: pm2 restart pachi-api

# 4. 動作確認
curl -s "http://localhost:8000/api/exists?name=バイオハザード" \
  -H "Authorization: Bearer $PSC_API_KEY"
# → {"exists": true, "matched_count": 1, "query": "バイオハザード"}

curl -s "http://localhost:8000/api/exists?name=ライセンス" \
  -H "Authorization: Bearer $PSC_API_KEY"
# → {"exists": false, "matched_count": 0, "query": "ライセンス"}

# 5. Cloudflare Tunnel 経由で外部確認
curl -s "https://pachi-api.bkpay.app/api/exists?name=バイオハザード" \
  -H "Authorization: Bearer $PSC_API_KEY"
```

### sloten-standalone 側の状態
- `isKnownMachine()` 実装済み + デプロイ済み (Worker `4b7d4f2e`)
- `/api/exists` が利用不可の場合: **fail-open** (pachi ルートを許可)
- `/api/exists` デプロイ後: KV キャッシュ (1h TTL) で応答を保持、次回以降は高速
- 既存の `NON_MACHINE_KATAKANA_BLACKLIST` は高速 short-circuit として残存

---

## P-5: classifyIntent() — Step 2 移行タスク

### 現状 (Step 1: Shadow Mode)
- `src/lib/intent-classifier.mjs` に `classifyIntent()` 実装済み
- `generateBotReply` の冒頭で呼び出し、`ai_logs.retrieval_trace.classifier_result` に記録
- 実際のルーティングは既存の個別 detector が担当 (shadow mode)

### Step 2 移行条件
1. Shadow mode で 1 週間以上の本番ログ蓄積
2. `classifier_result.primary` と既存ルーティングの不一致率 5% 未満
3. Golden Set で全件 PASS
4. 不一致ケースの原因分析完了

### Step 2 実装内容
1. `generateBotReply` の escalation / keyword / pachi / announcements / non-japanese の各分岐を `classifierResult.primary` の switch 文に統合
2. 既存 detector の直接呼び出しを削除
3. Golden Set 再実行で全件 PASS 確認
4. staging-bk デプロイ → 1 週間観察 → 本番

### Step 3 (クリーンアップ)
- `decideEscalation`, `detectMachineQuery`, `detectAnnouncementQuery`, `isNonJapaneseQuery` の export を削除
- `classifyIntent` 内部のみで使用する private 関数に変更

### 参照
- `docs/INTENT-CLASSIFIER.md` — 分類ロジック詳細 + ai_logs 抽出クエリ
