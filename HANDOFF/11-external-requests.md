# 外部依頼集約 — sloten-standalone 本番投入のための残作業

> 2026-05-08 作成 / 2026-05-09 更新 / 本番投入の最後のブロッカー解消用
> オーナー: rcc.aoki@gmail.com
> 現状: staging-bk Worker `0fc76ae3-1201-4ad6-99c5-aa5a95eb9d88` / Golden Set 58/58 PASS / Property tests 36/36 PASS / Soak 30min 完走 / Playwright v3 再走 31+ PASS (2026-05-09 完) / 本番投入評価 **78-80/100 想定** (Reality Checker B1-R 解消済)

---

## 1. BK エンジニアリングチームへ — Webhook URL 4 件 (CRITICAL)

### 状態
未提供。本番投入の **最大ブロッカー B2**。チャットの主要動線 (銀行振込/PayPay/コンビニATM/ボーナスコード) が webhook 経由で BK 受付システムへ転送される設計だが、URL なしでは死ぬ。

### 必要な情報
| 環境変数名 | 役割 |
|---|---|
| `BANK_TRANSFER_BOT_WEBHOOK_URL` | 銀行振込申請 → BK 受付シート |
| `GAS_BOT_WEBHOOK_URL` | PayPay 入金申請 → BK 受付 |
| `EC_DEPOSIT_BOT_WEBHOOK_URL` | コンビニ ATM 入金 → BK 受付 |
| `BONUS_CODE_WEBHOOK_URL` | ボーナスコード申請 → BK スプレッドシート |

**staging-bk 用と本番用で別 URL を発行**してください (テストデータと本番データの混在防止)。

### 期待される BK 側 webhook の応答仕様

```json
{
  "message": "ご申請ありがとうございます。3 営業日以内にお振込ください。",
  "set_vars": { "deposit_request_id": "DEP-12345" },
  "next": "deposit_done"
}
```

最低限 `200 OK` で空 JSON `{}` でも sloten 側は動作します。

### sloten 側挙動 (参考)
- timeout 8s で AbortController
- 5xx / network err は try/catch で `step.error_message` 表示 + `step.on_error` ステップへルーティング
- 詳細: [src/handlers/bot-flows.mjs:497-519](../src/handlers/bot-flows.mjs#L497-L519)

### DoD
- [ ] 4 URL × 2 環境 (staging-bk + prod) = 8 個の URL 受領
- [ ] sloten 側で staging-bk に provisioning
- [ ] 各フロー実行 → BK 側受付システムでデータ到着確認 → スクショ
- [ ] webhook fail-safe 実発火テスト 1 件 (URL を意図的に無効化 → error message 表示確認)

---

## 2. 運用チームへ — Telegram Bot Token + Chat ID (HIGH)

### 状態
未提供。`metrics-monitor.mjs` の cron は動作 (`[metrics] total=418 err=1.4% empty=1.4% p95=7985ms` ログ確認済) だが、Telegram dispatch が silent no-op。本番障害検知が機能しない。

### 必要な情報
| Secret | 取得方法 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather で新規 bot 作成 → `/newbot` → token を取得 |
| `TELEGRAM_CHAT_ID` | bot を運用チャンネル/グループに招待 → `https://api.telegram.org/bot<TOKEN>/getUpdates` で chat.id 取得 |

### Provisioning 手順
```powershell
cd C:\Users\PC\OneDrive\Desktop\sloten-standalone

# staging-bk 用
echo "<TELEGRAM_BOT_TOKEN>" | npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.staging-bk.toml
echo "<TELEGRAM_CHAT_ID>"   | npx wrangler secret put TELEGRAM_CHAT_ID   --config wrangler.staging-bk.toml

# 本番用 (本番初回デプロイ後)
echo "<TELEGRAM_BOT_TOKEN>" | npx wrangler secret put TELEGRAM_BOT_TOKEN
echo "<TELEGRAM_CHAT_ID>"   | npx wrangler secret put TELEGRAM_CHAT_ID
```

または `scripts/provision-monitoring.ps1` 実行 (テンプレ書式)。

### アラート閾値 (現行設定)
- `error_rate > 5%`: 警告
- `error_rate > 15%`: 緊急
- `empty_rate > 10%`: 警告
- `p95_latency > 5000ms`: 警告
- de-dup: 同種アラートは 5 分以内重複送信なし

### DoD
- [ ] Bot token + Chat ID 受領
- [ ] staging-bk に provisioning
- [ ] 閾値超過を人為注入 → Telegram に実発火 → スクショ
- [ ] 日次 09:00 JST サマリ送信確認 (1 日分)
- [ ] de-dup 動作確認 (同種 alert 連続発生 → 1 通のみ受信)

---

## 3. Sloten CS チームへ — Golden Set 9 エントリ (MEDIUM)

### 状態
`tests/golden-set/queries.json` の `source: tbd_bk_team` が 9 件残存 (`g-022, g-023, g-024, g-025, g-029, g-030, g-048, g-049, g-050`)。実顧客クエリで埋めることで coverage を「ドラフト用例」から「実運用シナリオ」に昇格できる。

### 各エントリの期待形式
| カテゴリ | 残数 | 何を入れるべきか |
|---|---|---|
| machine_spec | 4 (g-022〜025) | 実顧客がよく聞く機種スペック質問 (機種名+「天井」「継続率」「機械割」等の組合せ) |
| announcement | 2 (g-029, g-030) | 実際に問題になった period 質問 (例: 「先週の出金停止はもう解消した?」) |
| faq | 2 (g-048, g-049) | エッジケース FAQ (現行 17 件でカバーされていないシナリオ) |
| menu_keyword | 1 (g-050) | 実際にユーザーがよく入力する menu 直接ジャンプキーワード |

### 提供フォーマット (1 件あたり)
```json
{
  "input": "実際のユーザー入力",
  "expected_phrases": ["最低限含まれるべき語句 1", "語句 2"],
  "forbidden_phrases": ["含まれてはいけない語句 (誤回答パターン)"],
  "expected_handoff": false,
  "note": "なぜこのケースが重要か"
}
```

例 (drafted ベース):
```json
{
  "input": "天井1300Gの機種を教えて",
  "expected_phrases": ["1300", "G"],
  "forbidden_phrases": ["FAQ から", "BUY機能"],
  "expected_handoff": false,
  "note": "実顧客が天井数値で機種を絞り込みたいケース"
}
```

### データソース候補
- 本番 ai_logs (本番デプロイ後) — 実クエリの頻度別 top 50 から選定
- staging-bk 内テスト中のオペレーター入力ログ (もしあれば)
- カスタマーサポート FAQ 履歴・チャット記録

### DoD
- [ ] 9 件すべて実データで埋める
- [ ] `tests/golden-set/queries.json` を PR で更新 (CS 担当者がレビュー)
- [ ] `node tests/golden-set/run.mjs` で 62/62 PASS 確認
- [ ] 95% threshold gate を 92% などに緩めずに通る

---

## 4. PM/オーナーへ — 本番初回デプロイ判断 (BLOCKED)

### 状態
本番 Worker `sloten-standalone` 未デプロイ。CS チーム周知 + go/no-go 判断後に初回デプロイ。

### 初回デプロイチェックリスト
- [ ] 1, 2, 3 全項目完了
- [ ] Reality Checker スコア ≥ 80/100
- [ ] Playwright MCP セッションで現行 Worker `956860de-...` 以降の v3 完全再走 → 31/33 以上
- [ ] CS チームへ:
  - 4h sliding session TTL → 業務シフト中の自動延長 (アクセス時)
  - logout 即時失効 (revocation list)
  - 周知メール送付
- [ ] `scripts/rotate-signing-keys.ps1` の prod 行コメント解除
- [ ] 本番 secret 全 provisioning (GEMINI_API_KEY / PACHI_API_KEY / 3 鍵 / Telegram / Webhook 4 件)
- [ ] 段階投入: 1% → 10% → 50% → 100% (各 24h 観察)
- [ ] ロールバック手順実演 (staging で 1 回)

### 段階的本番投入プラン
| Stage | 期間 | トラフィック | go/no-go 基準 |
|---|---|---|---|
| Canary | 24h | 内部スタッフ 5 名のみ | error_rate < 1% |
| Stage 1 | 48h | 5% | + p95 < 5s, KV cache hit > 80% |
| Stage 2 | 72h | 25% → 50% | + ユーザー満足度 (CSAT) |
| GA | — | 100% | 全観測項目グリーン |

### ロールバック
```powershell
npx wrangler deployments list
npx wrangler rollback <previous-version-id>
```

---

## 進捗トラッキング (2026-05-09 更新)

```
- [外部依頼 1: BK Webhook]            _部分提供_ ← GAS_BOT 動作確認済 / BANK_TRANSFER 未設定 (URL 後日提供予定)
- [外部依頼 2: Telegram]              _保留_     ← token 取得は当面保留
- [外部依頼 3: CS Golden Set 9件]     ✅ 完了     ← 2026-05-09 実 Chatwoot data + 構築 (commit b79d32f)
- [自分作業 4: Playwright v3 再走]    ✅ 完了     ← 2026-05-09 31+ PASS
- [自分作業 5: wrangler.toml drift]   ✅ 完了     ← 2026-05-09 構造修正 (commit 56855cf)
- [自分作業 5b: R2 / Vectorize 検証]  ✅ 完了     ← 2026-05-09 R2 read/write OK / Vectorize 55 vectors populated
- [外部依頼 6: PM 本番デプロイ判断]   _BLOCKED_  ← 1 (BANK_TRANSFER URL) 待ち
```

## 2026-05-09 staging-bk 動作確認サマリ

| 項目 | 結果 |
|---|---|
| R2 (`sloten-standalone-staging-bk-files`) | ✅ put/get/delete 全て成功 |
| Vectorize (`sloten-kb-index-staging`) | ✅ 55 vectors (kb_chunks) populated, 1024-dim, query top-1 score 0.62 |
| Vectorize embedding model | `@cf/baai/bge-m3` (Workers AI 内蔵, 外部 API 課金なし) |
| `retrieval.use_vectorize` flag | `0` (まだ FTS5 がデフォルト, 切替は admin UI 経由) |
| GAS_BOT webhook (PayPayマネー) | ✅ 発火 + GAS 200 応答 ("テストスプレッドシートに記録しました") |
| BANK_TRANSFER webhook (銀行振込) | ❌ secret 未設定 → fallback 発動 |
| Telegram alerts | ❌ secrets 未設定 → silent no-op (cron は動作中, dispatch だけ無効) |
