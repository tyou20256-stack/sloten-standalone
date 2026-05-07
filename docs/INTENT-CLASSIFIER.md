# Intent Classifier — classifyIntent()

## 概要
`src/lib/intent-classifier.mjs` はユーザーメッセージの意図を 6 カテゴリに分類する統合関数。

## カテゴリ (優先順)

| 優先度 | Intent | 検出元 | 説明 |
|---|---|---|---|
| 1 | `escalation` | `decideEscalation()` | 苦情/法的/オペレーター呼び出し → AI バイパス |
| 2 | `menu_keyword` | `findKeywordMenu()` | キーワード→メニュー直結 → AI バイパス |
| 3 | `machine` | `detectMachineQuery()` | 機種スペック → pachi-rag |
| 4 | `announcement` | `detectAnnouncementQuery()` | お知らせ → announcements RAG |
| 5 | `non_japanese` | `isNonJapaneseQuery()` | 英語等 → 日本語のみ応答 |
| 6 | `rag_default` | (fallback) | FAQ + KB による Gemini RAG |

## 現在のステータス: Step 1 (Shadow Mode)

classifyIntent の結果は `ai_logs.retrieval_trace.classifier_result` に記録されるが、
実際のルーティングは既存の個別 detector が担当。

### ai_logs からの抽出クエリ

```sql
-- classifier_result の分布
SELECT
  json_extract(retrieval_trace, '$.classifier_result.primary') AS intent,
  COUNT(*) AS cnt
FROM ai_logs
WHERE retrieval_trace IS NOT NULL
  AND json_extract(retrieval_trace, '$.classifier_result') IS NOT NULL
GROUP BY intent
ORDER BY cnt DESC;

-- 既存ロジックとの不一致検出
SELECT
  id, input, output, status,
  json_extract(retrieval_trace, '$.classifier_result.primary') AS classifier_intent,
  json_extract(retrieval_trace, '$.pachi_detected') AS pachi_actual,
  json_extract(retrieval_trace, '$.announcement_detected') AS ann_actual
FROM ai_logs
WHERE retrieval_trace IS NOT NULL
  AND json_extract(retrieval_trace, '$.classifier_result.primary') = 'machine'
  AND json_extract(retrieval_trace, '$.pachi_detected') = 0
ORDER BY created_at DESC
LIMIT 20;

-- 分類信頼度の低いケース
SELECT
  id, input,
  json_extract(retrieval_trace, '$.classifier_result.primary') AS intent,
  json_extract(retrieval_trace, '$.classifier_result.confidence') AS conf
FROM ai_logs
WHERE json_extract(retrieval_trace, '$.classifier_result.confidence') < 0.6
ORDER BY created_at DESC
LIMIT 20;
```

## Step 2 への移行条件
1. Shadow mode で 1 週間以上のログ蓄積
2. 既存ロジックとの不一致が 5% 未満
3. Golden Set (tests/golden-set/) で全件 PASS
4. classifyIntent の primary でルーティングに切り替え
5. 旧 detector の直接呼び出しを削除

## Step 3 (最終)
- `decideEscalation`, `detectMachineQuery`, `detectAnnouncementQuery` を classifyIntent 内部のみで使用
- generateBotReply から直接参照を削除
