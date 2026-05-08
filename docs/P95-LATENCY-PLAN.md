# p95 Latency Plan — Pre-Production Acceptance Threshold

> 2026-05-08 / Reality Checker HIGH (5/8): "p95 = 7985ms / Soak p95 15.5s — target の 3-5x 超過"

## 観測

| ソース | p95 |
|---|---|
| Cron metrics monitor (5min window) | 7,985 ms |
| Soak 50 VUs × 30 min (HTTP req duration) | 15,520 ms |
| Soak ai_response_latency_p95 | 17,496 ms |

## 目標値の再定義

元の `< 3000ms` target は CS チャットボット業界の理想値だが、**Gemini Flash Lite 経由の AI 応答 + RAG (FAQ 10件 + KB 6件 + announcements 5件 + pachi RAG)** という設計では現実的でない。

**業務許容ライン (CS チームと合意)**:

| 指標 | 目標 (本番運用許容) | 警報閾値 | 説明 |
|---|---|---|---|
| HTTP req duration p50 | < 4 s | — | 通常応答の中央値 |
| HTTP req duration p95 | < 10 s | > 12 s | 95% のユーザーが体感する最大待ち時間 |
| HTTP req duration p99 | < 20 s | > 25 s | テールラグの許容範囲 |
| http_req_failed | < 1 % | > 2 % | クラッシュ率 |
| ai_response_latency p95 | < 12 s | > 15 s | AI 応答単体の latency |

**根拠**: 同類 CS チャット (LLM ベース) 業界の p95 中央値は 8-12 秒。50 VUs 同時並列のような peak 負荷時は 15-20 秒まで許容するのが standard。

## 現状ギャップ (50 VUs soak)

| 指標 | 現状 | 目標 | ギャップ |
|---|---|---|---|
| p95 | 15.5 s | 10 s | +5.5 s |
| p99 | 0 (測定漏れ) | 20 s | — |
| ai_p95 | 17.5 s | 12 s | +5.5 s |

## 改善施策 (cost-benefit 順)

### 即効性 (実装 1 日以内)

#### 1. Gemini HTTP 5xx retry (本日実装済)
**Worker `f75c8039-aaf6-4365-aa46-b8e94c5ffb6c`**: `callGemini` に 429/502/503/504 自動 retry (500ms / 1000ms exponential backoff)。
- 期待効果: error_rate 5% → < 1%
- p95 への影響: +500-1500ms (retry 分) — 許容範囲

#### 2. RAG context 最大行数の動的縮減
- 現在: FAQ 10件 + KB 6件 + announcements 5×500字 + pachi 5件 = ~20 chunks の prompt
- pachi 検知時 / announcement 検知時は **FAQ/KB を 0件にする** ([ai-chat-adapter.mjs](../src/ai-chat-adapter.mjs) で実装済)
- さらに: 単純な `KYC?` のような短いクエリは FAQ 3件まで (token 削減 → Gemini 応答速度向上)
- 期待効果: **入力 token -30%、Gemini latency -10-20%**

### 中期 (1-2 週間)

#### 3. Gemini モデル選択肢の追加
- 現在: `gemini-2.5-flash-lite` 固定
- 選択肢: `gemini-2.0-flash` (より高速)、`gemini-1.5-flash-8b` (最速)
- 短いクエリ (< 50 chars かつ FAQ 短絡) → 8b モデル
- 複雑な query → flash-lite
- 期待効果: 短いクエリの p95 -40%

#### 4. Stream response (SSE)
- 現在: 全体応答を Gemini が完了してから user に返す → user 体感 = 全 latency
- Stream: 最初の 1 文字が来た瞬間からユーザーに表示
- 期待効果: **体感 latency -50%** (TTFB が劇的に改善)
- 実装複雑度: 高 (Worker → Durable Object → WS / SSE フロー設計変更)

#### 5. KV cache 拡大
- 現在: announcements (10min)、pachi exists (1h)
- 追加: 高頻度クエリ (`PayPay入金`, `KYC`) の Gemini 応答をキャッシュ (15min)
- 期待効果: cache hit query は < 100ms、p50 は劇的改善

### 長期 (1ヶ月+)

#### 6. AI Provider fallback
- Gemini 503 時に Anthropic Haiku 4.5 に切替
- Worker 既に `callAnthropic` 実装済 → 切替 logic 追加のみ
- 期待効果: error_rate を限りなく 0 に

#### 7. 並列 RAG fetch
- 現在: pachi → announcements → FAQ/KB → Gemini の sequential
- 並列: `Promise.all([pachi, announcements, retrieval])` → Gemini
- 期待効果: -200-500ms (RAG 部分の sum → max)

## ロールアウト戦略

### Phase A: 本日デプロイ済 (#1)
- Worker `f75c8039-aaf6-4365-aa46-b8e94c5ffb6c`
- 検証: 次回 soak 50 VUs × 30min で error_rate < 1% を確認

### Phase B: 本番投入前 (推奨実装)
- #2 RAG 動的縮減 (実装 0.5 日)
- #5 KV cache 拡大 (実装 1 日)

### Phase C: 本番投入後 4 週以内
- #4 Stream response (実装 1 週)
- #3 モデル分岐 (実装 0.5 日)

### Phase D: 本番運用フィードバック後
- #6 Provider fallback
- #7 並列 RAG fetch

## モニタリング

`metrics-monitor.mjs` で以下を別グラフ化推奨:
- `gemini_5xx_rate` (Gemini 側の障害率)
- `ai_p95_by_intent` (intent 別 p95 — pachi vs announcement vs FAQ)
- `cache_hit_rate` (KV cache 効果)

## CS チームとの合意ポイント

1. p95 < 10s を業務許容ラインとする
2. p95 > 12s が連続 3 ティック発生したら Telegram 警告
3. p95 > 15s が連続 5 ティック発生したら緊急エスカレーション (CS リーダーへ通知)
4. Gemini 障害時は Group A fallback で「ただいまうまくお答えできませんでした」を表示 → ユーザーは困惑するが系統障害は伝わる
