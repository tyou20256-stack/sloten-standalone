# Monitoring + Telegram Alert

## 概要
ai_logs ベースの 5 分間隔メトリクス監視 + Telegram アラート + 日次サマリ。

## アーキテクチャ

```
Cron Trigger (毎分) → scheduled.mjs
  ├── minute % 5 == 0 → runMetricsMonitor()
  │     ├── D1: ai_logs WHERE created_at >= now-5min
  │     ├── 計算: error_rate, empty_rate, escalation_rate, p95
  │     ├── 閾値チェック
  │     ├── KV de-dup (同一 alert を 5 分以内に重複送信しない)
  │     └── Telegram Bot API → sendMessage
  └── hour==0 && minute==0 (UTC) → runDailySummary()
        ├── D1: ai_logs WHERE created_at >= now-24h
        └── Telegram → 日次サマリ
```

## 閾値

| メトリクス | 警告 | 緊急 | アラート例 |
|---|---|---|---|
| error_rate | > 5% | > 15% | `⚠️ エラー率 7.3% (8/110件)` |
| empty_response_rate | > 10% | — | `⚠️ 空応答率 12.5% (5/40件)` |
| p95_latency_ms | > 5000ms | — | `⚠️ p95レイテンシ 6200ms` |

## De-duplication
- KV key: `alert:dedup:<alert_type>` (TTL = 5 min)
- 同一 alert type は 5 分以内に 1 回のみ送信
- 5 分後にまだ閾値超過していれば再送

## Secrets

| Secret | 用途 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot API トークン (@BotFather で取得) |
| `TELEGRAM_CHAT_ID` | 通知先のグループ/チャット ID |

未設定時は no-op (エラーなし)。

## Provisioning

```powershell
.\scripts\provision-monitoring.ps1
```

## 日次サマリ例

```
📊 日次サマリ (過去24h)
総リクエスト: 342
エラー率: 2.3% (8件)
空応答率: 1.5% (5件)
エスカレーション: 12件 (3.5%)
レイテンシ: p50=3200ms / p95=6800ms
```

## 手動テスト

```bash
# staging-bk の cron を手動トリガー
curl -X POST "https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/__scheduled" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"

# wrangler tail で metrics ログを確認
npx wrangler tail --config wrangler.staging-bk.toml --format pretty \
  | grep "\[metrics\]"
```

## ファイル

| ファイル | 役割 |
|---|---|
| `src/handlers/metrics-monitor.mjs` | メトリクス計算 + 閾値チェック + Telegram 送信 |
| `src/scheduled.mjs` | cron dispatcher (5 分 / daily) |
| `scripts/provision-monitoring.ps1` | secret provisioning |
