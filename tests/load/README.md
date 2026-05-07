# Soak Test (k6) — sloten-standalone

50 同時会話 × 30 分の負荷テスト。各 VU は会話を作成し、Golden Set からランダムに 5-10 メッセージを送信。

## 前提
- k6 がインストール済み (または Docker)
- staging-bk に対して実行 (本番禁止)

## 実行方法

### ローカル (k6 インストール済み)
```bash
# Dry run (5 VUs × 30s)
k6 run --vus 5 --duration 30s tests/load/soak.js

# 本格実行 (50 VUs × 30m)
k6 run --vus 50 --duration 30m tests/load/soak.js

# 環境変数で BASE_URL を変更
k6 run -e BASE_URL=https://your-worker.dev tests/load/soak.js

# 結果を JSON に保存
k6 run --vus 50 --duration 30m --out json=results.json tests/load/soak.js
```

### Docker
```bash
# Dry run
docker run -i grafana/k6 run --vus 5 --duration 30s - < tests/load/soak.js

# 本格実行
docker run -i grafana/k6 run --vus 50 --duration 30m - < tests/load/soak.js

# 環境変数指定
docker run -i -e BASE_URL=https://sloten-standalone-staging-bk.rcc-aoki.workers.dev \
  grafana/k6 run --vus 50 --duration 30m - < tests/load/soak.js
```

## Thresholds (合格基準)

| メトリクス | 基準 | 説明 |
|---|---|---|
| `http_req_failed` | < 1% | リクエスト失敗率 |
| `http_req_duration p95` | < 3000ms | 95%tile レイテンシ |
| `http_req_duration p99` | < 8000ms | 99%tile レイテンシ (AI 応答込み) |

## カスタムメトリクス

| メトリクス | 説明 |
|---|---|
| `contact_created` | contact 作成成功率 |
| `conversation_created` | 会話作成成功率 |
| `message_sent` | メッセージ送信成功率 |
| `bot_replied` | bot が応答を返した率 |
| `ai_response_latency` | AI 応答の実レイテンシ (p50/p95) |

## 結果サマリ例

```markdown
| 指標 | 結果 |
|---|---|
| VUs | 50 |
| Duration | 30m |
| Total requests | ~5000 |
| Error rate | 0.2% |
| p95 latency | 2400ms |
| p99 latency | 6800ms |
| Bot reply rate | 98% |
| AI p50 latency | 4200ms |
| AI p95 latency | 7800ms |
```

## Soak 後のクリーンアップ

テストで大量の会話が作成されるため、完了後にクリーンアップ:

```bash
# staging-bk の D1 から soak テスト会話を削除
npx wrangler d1 execute sloten_standalone_db_staging_bk \
  --config wrangler.staging-bk.toml --remote \
  --command="DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE created_at > datetime('now', '-1 hour'));"

npx wrangler d1 execute sloten_standalone_db_staging_bk \
  --config wrangler.staging-bk.toml --remote \
  --command="DELETE FROM conversations WHERE created_at > datetime('now', '-1 hour');"

npx wrangler d1 execute sloten_standalone_db_staging_bk \
  --config wrangler.staging-bk.toml --remote \
  --command="DELETE FROM contacts WHERE created_at > datetime('now', '-1 hour');"
```

## 注意事項
- Cloudflare Workers の rate limit: 50 VUs は Free プランだと超過の可能性
- D1 write quota: 1 日 100K writes (Free) — 50VUs × 10msg × 30min ≈ 15K writes
- 本番には絶対に実行しないこと
