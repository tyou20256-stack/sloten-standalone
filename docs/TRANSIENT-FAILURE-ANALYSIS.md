# Transient Failure Analysis

> 2026-05-08 / Test Analyzer 残 gap (P0): "Transient failure 2 件の根因未特定"

## 観測

`ai_logs` を直近 2 時間で集計:
```sql
SELECT substr(error_message, 1, 100) AS err,
       json_extract(retrieval_trace, '$.finish_reason') AS finish,
       json_extract(retrieval_trace, '$.retried') AS retried,
       COUNT(*) AS n
FROM ai_logs WHERE status='error'
  AND created_at >= datetime('now', '-2 hours')
GROUP BY 1,2,3 ORDER BY n DESC;
```

結果:
| err | finish_reason | retried | n |
|---|---|---|---|
| `Gemini HTTP 503: This model is currently experiencing high traffic` | NULL | 0 | 1 |

Soak 実行時 (2548 件) も全 122 errors が同パターン。

## 根因

**Gemini Flash Lite の容量制限** — Google 側の `RESOURCE_EXHAUSTED` (503) 応答。
コード側の問題ではなく外部依存の rate limit。

## 既存 retry policy との gap

[ai-chat-adapter.mjs:462-491](../src/ai-chat-adapter.mjs#L462-L491) の retry は:
- ✅ `finishReason === 'MAX_TOKENS'` → maxOutputTokens 2x で retry
- ✅ 空 + `STOP` → temperature 0.5 で retry
- ❌ **HTTP 5xx (503/504/502)** → throw され `status='error'` で記録、retry なし

callGemini が `if (!r.ok) throw new Error(...)` で投げるため、retry blockへ入らない。

## 推奨対応

### Option A: callGemini に HTTP 5xx retry (推奨)
```javascript
// ai-chat-adapter.mjs callGemini 内
const TRANSIENT_HTTP_STATUS = new Set([429, 502, 503, 504]);
let r;
for (let attempt = 0; attempt <= 2; attempt++) {
  r = await fetch(url, { ... });
  if (r.ok) break;
  if (!TRANSIENT_HTTP_STATUS.has(r.status)) throw new Error(...);
  if (attempt < 2) await new Promise(s => setTimeout(s, 500 * Math.pow(2, attempt)));
}
if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${await r.text()}`);
```

期待効果: Soak 中の 5% error rate (122/2548) が < 1% に低下する見込み (Gemini 側障害が 1.5s 以内に回復するケースが大半)。

### Option B: 上位レイヤーでの retry
generateBotReply の status='error' branch から呼び元 (messages-native.mjs) に retryable error を返し、そちらで retry。複雑になるため非推奨。

### Option C: 現状維持 + Group A fallback で吸収
ユーザーには「申し訳ございません、ただいまうまくお答えできませんでした」が表示される。UX としては許容範囲。ただし運用側で error_rate アラート発火する可能性あり。

## 推奨: Option A 実装

実装コスト 5 行、回帰リスク低 (callGemini ローカル変更のみ)。本番投入前に実施推奨。

## 実装後の検証

1. デプロイ後、k6 soak 30min 再実行
2. ai_logs status 内訳を比較:
   - Before: ok 87% / escalated 8% / error 5%
   - After (期待): ok 91-92% / escalated 8% / error <1%
3. p95 latency への影響確認 (retry 分 +500ms-1.5s 増加見込み)

## モニタリング推奨

`metrics-monitor.mjs` に gemini_5xx_rate 別カウンタを追加すると、Gemini 側障害を sloten 内バグから区別できる:
```javascript
const gemini5xx = entries.filter(r =>
  r.status === 'error' && /Gemini HTTP 5\d\d/.test(r.error_message || '')
).length;
metrics.gemini_5xx_rate = total > 0 ? gemini5xx / total : 0;
```
