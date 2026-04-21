# Self-Healing / Auto-Remediation レイヤー設計

**エージェント**: AI Data Remediation Engineer
**視点**: 自動化失敗時の self-healing パイプライン

---

## 1. Failure Modes 棚卸し

| # | 破綻 | 頻度 | 顧客影響 | 現状検出 | 現状復旧 |
|---|------|------|---------|---------|---------|
| 1 | GAS→Chatwoot 5xx | occasional | severe (無応答) | なし | 手動 |
| 2 | GAS→D1 書込失敗 | occasional | minor (遅延) | `gas_forwarded=0` 残存 | 手動 |
| 3 | state_json 破損 | rare | severe (会話停止) | なし | 手動シート編集 |
| 4 | シート並行編集競合 | frequent | minor | なし | GAS LockService |
| 5 | 取引番号重複送信 | frequent | minor | 手動目視 | 手動 |
| 6 | 着金待ち放置 | occasional | severe (顧客離脱) | スタッフ記憶 | なし |
| 7 | GAS 6分上限 | rare | invisible | GAS エラーログ | なし |
| 8 | Webhook 順序乱れ | rare | minor | なし | なし |
| 9 | D1↔シート divergence | occasional | severe (金額不一致) | なし | 手動集計 |
| 10 | bonus_code 誤削除 | rare | severe | 顧客クレーム | 手動復元 |

## 2. Remediation Layer 設計

### a) Reconciliation Job (Cloudflare Cron, 日次 03:00 JST)

**D1 側 gas_forwarded=0 sweep**
```sql
SELECT id, transaction_no, created_at, retry_count
FROM bonus_code_submissions
WHERE gas_forwarded = 0
  AND created_at < datetime('now', '-15 minutes')
  AND retry_count < 5
LIMIT 100;
```
→ Workers から GAS webhook 再送、成功時 `gas_forwarded=1, forwarded_at=NOW()`、失敗時 `retry_count++, last_error=...`。

**D1↔シート diff checker**
GAS が `/api/reconcile/deposits` を叩き、過去 48h の「着金確認」シート全行を JSON で Workers に POST。Workers 側で `deposit_requests` と transaction_no ベース full outer join → 差分を `reconciliation_diffs` テーブルに記録、Slack に Top 10 を投稿。

**24h 着金待ち stuck 検出**
Chatwoot conversations API を `label=着金待ち` かつ `last_activity_at < now-24h` で list → D1 `investigation_tasks` に insert、担当者 Slack mention。

### b) Retry & DLQ (Cloudflare Queues)

```
chatwoot-send-queue (primary)
  ├─ consumer: retry with 1s/5s/30s/5m/30m backoff
  └─ max_retries=5 → chatwoot-send-dlq
                     └─ Slack #sloten-dlq + D1 dlq_messages
```

Queue message schema:
```json
{
  "type": "chatwoot.message.send",
  "conversation_id": 1234,
  "payload": {...},
  "idempotency_key": "tx_20260417_0042",
  "attempt": 0,
  "first_queued_at": "2026-04-17T..."
}
```

Idempotency_key は D1 `sent_messages(idempotency_key UNIQUE)` で二重送信防止。

### c) State Healing

**破損 JSON detect**: GAS の state 読込時 try/catch で `JSON.parse` 失敗を捕捉 → `state_corruption_log` シートに raw_json + conversation_id + timestamp を残し、`state_json = {"step":"RECOVERED","recovered_from":"<backup_id>"}` で初期化。直近の正常 state を `state_snapshots` シート (1h 毎 snapshot) から復元を試み、無ければ顧客に「お手数ですが最初からお願いします」メッセージ。

**重複 transaction_no**: D1 で `UNIQUE(transaction_no, date)` 制約。INSERT 時 constraint violation → 既存 receipt を返しつつ `duplicate_submissions` に記録。3 回以上同一 tx_no → fraud flag。

### d) Heartbeat / Canary

Cloudflare Cron `*/5 * * * *`:
1. Canary conversation_id=99999 に合成 webhook POST
2. 60 秒後に D1 `bonus_code_submissions` で該当レコード確認
3. GAS 経由で Chatwoot に応答があるか確認
4. 全 green なら `canary_runs(status='ok')`、赤なら Slack P1 alert

## 3. Observability スキーマ

**D1 events_log (薄い中央テーブル)**
```sql
CREATE TABLE events_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,          -- epoch ms
  source TEXT NOT NULL,         -- 'workers'|'gas'|'chatwoot'
  step TEXT NOT NULL,           -- 'webhook.received'|'gas.forward'|'chatwoot.reply'
  status TEXT NOT NULL,         -- 'ok'|'retry'|'failed'
  duration_ms INTEGER,
  ref_id TEXT,                  -- conversation_id or tx_no
  error_code TEXT,
  meta_json TEXT
);
CREATE INDEX idx_events_ts_step ON events_log(ts, step);
```

**GAS 側 Logger wrapper**
```javascript
function logEvent(step, status, refId, durationMs, errorCode) {
  UrlFetchApp.fetch(WORKERS_LOG_ENDPOINT, {
    method: 'post',
    payload: JSON.stringify({source:'gas', step, status, ref_id:refId,
      duration_ms:durationMs, error_code:errorCode, ts:Date.now()}),
    muteHttpExceptions: true
  });
}
```

**集計ダッシュボード (Workers Cron 1h)**
```sql
SELECT step,
  COUNT(*) AS volume,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)*1.0/COUNT(*) AS fail_rate,
  AVG(duration_ms) AS avg_ms
FROM events_log
WHERE ts > unixepoch('now','-1 hour')*1000
GROUP BY step;
```
→ Google Sheets 「運用ダッシュボード」に upsert、fail_rate>5% で条件付き書式赤 + Slack。

Queue depth は Cloudflare Queues Analytics API を 5 分毎に pull。

## 4. 段階的導入

**Phase A (今すぐ, 1 週間)**: events_log テーブル + GAS Logger wrapper + Sheets ダッシュボード。壊れても人が気づける状態にする。canary 1 本だけ先行。

**Phase B (1 ヶ月)**: Cloudflare Queues で retry+DLQ、reconciliation cron 3 本 (gas_forwarded sweep / deposit diff / 24h stuck)、idempotency_key UNIQUE 制約、state_snapshots 1h 毎。

**Phase C (3 ヶ月)**: state 自動復元、predictive alert (fail_rate の 7 日移動平均+3σ 超過で warn)、bonus_code 削除は soft delete (deleted_at) 化して 30 日復元可能。

## 5. Remediation Code 例

**例1: gas_forwarded=0 再送 cron (Cloudflare Workers)**
```typescript
export default {
  async scheduled(event, env) {
    const stuck = await env.DB.prepare(`
      SELECT id, transaction_no, payload_json, retry_count
      FROM bonus_code_submissions
      WHERE gas_forwarded = 0
        AND retry_count < 5
        AND created_at < datetime('now','-15 minutes')
      LIMIT 50
    `).all();

    for (const row of stuck.results) {
      const backoff = Math.pow(2, row.retry_count) * 1000;
      try {
        const res = await fetch(env.GAS_WEBHOOK_URL, {
          method: 'POST',
          headers: {'X-Idempotency-Key': row.transaction_no},
          body: row.payload_json
        });
        if (res.ok) {
          await env.DB.prepare(
            `UPDATE bonus_code_submissions
             SET gas_forwarded=1, forwarded_at=CURRENT_TIMESTAMP WHERE id=?`
          ).bind(row.id).run();
        } else throw new Error(`gas_${res.status}`);
      } catch (e) {
        await env.DB.prepare(
          `UPDATE bonus_code_submissions
           SET retry_count=retry_count+1, last_error=? WHERE id=?`
        ).bind(String(e), row.id).run();
      }
    }
  }
};
```

**例2: D1↔シート deposit diff (GAS)**
```javascript
function reconcileDeposits() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('着金確認');
  const rows = sheet.getDataRange().getValues().slice(1);
  const sheetMap = new Map(rows.map(r => [r[2], {amount:r[3], confirmed:r[5]}]));
  const d1Rows = fetchD1('/api/deposits/recent?hours=48');
  const diffs = [];
  for (const d of d1Rows) {
    const s = sheetMap.get(d.transaction_no);
    if (!s) diffs.push({tx:d.transaction_no, issue:'missing_in_sheet', d1_amount:d.amount});
    else if (Number(s.amount) !== Number(d.amount))
      diffs.push({tx:d.transaction_no, issue:'amount_mismatch', sheet:s.amount, d1:d.amount});
  }
  if (diffs.length) postSlack(`deposit diff ${diffs.length}件`, diffs.slice(0,10));
  writeSheet('reconciliation_diffs', diffs);
}
```

## 6. ガードレール

| 制約 | 閾値 | 実装 |
|------|------|------|
| 同一 tx_no 再送上限 | 5 回/24h | `retry_count < 5` + UNIQUE idempotency_key |
| 自動 rollback 金額上限 | 5,000 円未満のみ | `if (amount >= 5000) route_to_human` |
| 連続失敗で自動化停止 | 10 件連続 failed で circuit open | `failure_streak` テーブル, 15 分後 half-open |
| 1 ジョブ 1 回の処理上限 | 100 行/run | `LIMIT 100` + 残は次回 |
| Canary 失敗で retry 停止 | canary 3 回連続赤 → queue consumer pause | KV flag `automation_enabled=false` |
| 人間 escalation | DLQ 投入 / circuit open / diff>50 件 | Slack P1 + PagerDuty |

**circuit breaker 実装**: Workers KV に `circuit:chatwoot_send = {state, opened_at, streak}` を保持。open 中は queue consumer が即 retry せず 15 分後 half-open で 1 件だけ試行、成功で closed。

**Kill switch**: 全 remediation cron は先頭で `if (!await env.KV.get('automation_enabled')) return;` をチェック。運用者が 1 コマンドで全自動化停止可能。

---

**設計の芯**: 本番データに自動で「書き換え」を走らせるのは (a) reconciliation で見つけた不整合の再送、(b) 金額 5,000 円未満の rollback、(c) state 破損時の初期化、の 3 ケースだけに限定する。それ以外は必ず human queue に落とす。すべての自動書換には idempotency_key と events_log エントリがセットで、後から「誰が (どの cron が) いつ何を変えたか」を SQL 1 本で再現できる状態を死守する。
