# Experiment Tracker 視点: A/B テスト基盤と継続改善

**エージェント**: Experiment Tracker
**視点**: A/B テスト / shadow mode / canary rollout / 統計的有意性
**総合所見**: 動いてるだけの A/B を「勝者が決まり継続改善される」体制に引き上げる。

---

## 1. 現状 A/B の致命的欠陥

- **汚染データ**: `oor` / `oor-1145` (body="x", weight=100) が 66% のトラフィックを吸収し、`default-A/B` は残り 34% を分け合う。実質サンプル半減
- **成功指標が未定義**: `ai_logs` に `prompt_id` はあるが、CSAT・再質問率・エスカレーション率などの Outcome カラムが無く、join しても「勝敗」を判定できない
- **SRM (Sample Ratio Mismatch) 未検査**: weight=50/50 でも実配布が偏ってるか不明。`pickActivePrompt()` の RNG バイアス検証ゼロ
- **早期停止ルールなし**: 見た人の気分で切り替え可能 → peeking problem で偽陽性量産
- **多重比較補正なし**: 4 prompts 同時 = α=0.05 でも family-wise 誤り率 ~18%

**即対応**: `UPDATE ai_prompts SET is_active=0 WHERE id IN ('oor','oor-1145');`

---

## 2. Prompt 実験プロトコル

```
[1] Hypothesis 登録 (experiments table 新設)
[2] Shadow (0% user-visible, 100% logged) — 3日
[3] Canary (5% → 20% → 50%) — 各 3日、guardrail 監視
[4] Decision: 有意 lift あり → 100%、無ければ archive
```

`experiments` テーブル追加案:
```sql
CREATE TABLE experiments (
  id TEXT PRIMARY KEY, prompt_id TEXT, hypothesis TEXT,
  stage TEXT CHECK(stage IN ('shadow','canary','rollout','archived')),
  traffic_pct INTEGER DEFAULT 0, started_at INTEGER,
  primary_metric TEXT, success_threshold REAL
);
```

---

## 3. Shadow Mode 設計

本番レスポンスは現行 prompt で返しつつ、候補 prompt を並列実行してログのみ取る。Cloudflare Workers では `ctx.waitUntil()` で非同期化しレイテンシ 0 に。

```typescript
const primary = await callLLM(activePrompt, userMsg);
ctx.waitUntil((async () => {
  for (const shadow of shadowPrompts) {
    const resp = await callLLM(shadow, userMsg);
    await env.DB.prepare(
      `INSERT INTO ai_logs_shadow (prompt_id, user_msg_hash, response, latency_ms, tokens, created_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(shadow.id, hash(userMsg), resp.text, resp.ms, resp.tokens, Date.now()).run();
  }
})());
return primary;
```

ユーザーには影響ゼロ、LLM コストのみ 2-3x。判定は人手レビュー or LLM-as-judge (`gpt-4o-mini` で pairwise 評価)。

---

## 4. 統計的有意性 — 15 req/日

- ベースライン CSAT=70%、目標 lift=10pt (70→80%)
- 2-proportion z-test, α=0.05, power=0.80 → **n≈294/arm**
- 50/50 split なら 1日 7.5 req/arm → **~40 日**必要
- 5% 改善検出 → n≈1,030/arm → 約 140 日（事実上不可能）
- **結論**: 10pt 以上の大きな差しか検出できない。微小改善は LLM-as-judge の pairwise 勝率 (n=50 で p<0.05) に頼る

---

## 5. 実験優先順位

1. **Prompt** (最高 ROI, デプロイ数分, コスト不変) ← 現状ここ未完
2. **RAG retrieval** (top-k, reranker on/off) — 引用精度に直結、ログで計測しやすい
3. **Model** (haiku vs sonnet) — コスト差 3x、quality 差要検証
4. **Temperature** (0.3 vs 0.7) — 最後。顧客サポートでは 0.3 固定でほぼ正解

---

## 6. staging-bk 活用

```
staging-bk (D1 staging) → 合成データ 500件を replay
  ↓ LLM-as-judge で candidate vs control 勝率算出
  ↓ 勝率 >55% なら本番 shadow へ昇格
本番 shadow (3日) → canary 5% → rollout
```

過去ログ replay SQL:
```sql
SELECT user_message, response AS control_response
FROM ai_logs WHERE created_at > unixepoch('now','-30 days')
ORDER BY RANDOM() LIMIT 500;
```

`feature_flags` でステージ制御:
```sql
INSERT INTO feature_flags (key, value, updated_at) VALUES
  ('experiment.prompt-v3.stage', 'canary', unixepoch()),
  ('experiment.prompt-v3.traffic_pct', '5', unixepoch());
```

Worker 側:
```typescript
const stage = await env.DB.prepare(
  `SELECT value FROM feature_flags WHERE key=?`
).bind('experiment.prompt-v3.stage').first();
if (stage?.value === 'canary' && Math.random()*100 < pct) usePrompt('v3');
```

---

## 推奨 KPI (Experiment Tracker)

月次で「実験数・勝率・平均 lift・rollback 率」を定点観測。407 calls/月なら月 1-2 本が現実的上限。
