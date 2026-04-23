# AI Engineer 視点: RAG アーキテクチャと retrieval 精度

**エージェント**: AI Engineer
**視点**: RAG / embeddings / vector search / reranker / chunking
**対象**: `src/ai-chat-adapter.mjs` を中心とした AI 回答精度の構造的ボトルネック

---

## 現状の構造的ボトルネック TOP 3

### 1. 検索が priority ソートのみで、意味的マッチング皆無（`ai-chat-adapter.mjs:54-60`）
`ORDER BY priority DESC, usage_count DESC LIMIT 15` で top-N を固定取得。ユーザー発話と無関係な FAQ が常に注入され、関連 FAQ が 16 位以下に沈むと永遠に引かれない。47 FAQ あって質問との距離を一切測っていないのは、RAG ではなく「静的プロンプト」。`knowledge_chunks` が 0 行なのも裏付け。

### 2. KB コンテキスト品質がタイトル+3000 字切り捨てで情報密度が低い（`buildSystemPrompt:20-22`）
`content.slice(0, 3000)` × 8 件 = 最大 24k 文字を毎回注入。Flash Lite の attention は希釈され、該当セクションへの注視が落ちる。しかも分割（chunking）していないので、1 記事の前半 3000 字だけで後半（回答が書かれている部分）が切られるケースが頻発しているはず。

### 3. FAQ 承認率 19/606 = 3.1% の低 yield がデータ品質問題を示す
606 候補から 587 却下は「ユーザ発話ベースで FAQ を増やすパイプライン」が機能していない兆候。かつ `tokens_in/out` が NULL なので「どの FAQ がヒットして効いたか」の因果追跡も不能。KPI ドリブンに改善できない状態。

---

## 改善施策 5 つ

### 施策 A: D1 FTS5 による BM25 retrieval 導入
- **目的**: priority ソートを意味的関連度に置き換え
- **実装**: `faq_fts` / `kb_chunks_fts` 仮想テーブル作成 → `MATCH` クエリで top-K。日本語は `unicode61 remove_diacritics 2` + 簡易 bigram tokenizer（Workers 上で形態素は重いので bigram 妥協）
- **期待効果**: 無関係 FAQ 注入を 70%以上削減、注入トークン数 40%↓ → latency 改善
- **工数**: **S**（1-2日、マイグレーション + クエリ置換のみ）

### 施策 B: knowledge_chunks を埋めて意味検索（Vectorize + Workers AI embeddings）
- **目的**: 固有表現や言い換え（「出金」↔「引き出し」）に対応
- **実装**: `@cf/baai/bge-m3` or `bge-small-ja` で 500字チャンク埋め込み → Vectorize index。クエリ時も同モデルで埋め込み → top-K 取得
- **期待効果**: 既存 BM25 では拾えない言い換え質問の accuracy +15-20pt
- **工数**: **M**（3-5日、indexing バッチ + retrieval 統合 + re-index 運用）

### 施策 C: Hybrid retrieval + RRF リランク
- **目的**: BM25（完全一致強）と埋め込み（言い換え強）を統合
- **実装**: 両方から top-20 → Reciprocal Rank Fusion（`score = Σ 1/(60+rank)`）→ top-8。リランカーは Workers 内で純 JS 実装可
- **期待効果**: 単独比 recall@8 で +10-15pt、特にロングテール質問
- **工数**: **S**（A/B 完了後 0.5-1日）

### 施策 D: tokens / retrieval trace を `ai_logs` に記録
- **目的**: どの FAQ/KB が注入され、どれが「回答に寄与したか」を観測可能に
- **実装**: Gemini `usageMetadata.promptTokenCount/candidatesTokenCount` を保存。注入 FAQ/KB の ID 配列を JSON カラムに。週次で「引かれたが不採用 FAQ」を抽出し承認フローに戻す
- **期待効果**: FAQ 承認率 3.1% → 15%+ の改善ループが回る
- **工数**: **S**（半日）

### 施策 E: チャンク境界を意味単位に（見出し/Q-Aペア）+ 最大 1200 文字
- **目的**: 3000字切り捨てで回答本体が欠落する事故を撲滅
- **実装**: `knowledge_sources.content` を `\n##`, `\nQ:`, 空行 3+ で分割 → 1200 文字上限。title を各チャンクに prefix して文脈保持
- **期待効果**: KB 由来回答の「情報不足」型エラー削減、1コール注入量 20-30%↓
- **工数**: **M**（2-3日、23 sources を再処理 + ingestion pipeline）

---

## Cloudflare Workers 制約下での現実解

- **D1 FTS5** は D1 でネイティブサポート（`CREATE VIRTUAL TABLE ... USING fts5`）。追加インフラ 0、100ms 以内で top-K。**最優先**
- **Vectorize** は Workers から直接叩けて 10ms 程度。`@cf/baai/bge-m3`（多言語、1024 dim）が現実的。ただし Workers AI 呼び出しで +50-100ms 増えるので、BM25 が先、埋め込みは BM25 低スコア時のみの条件付き起動が効率的
- **リランカー**（cross-encoder）は Workers AI の `@cf/baai/bge-reranker-base` を使えるが +150ms。まず RRF で済ませて効果測定後に導入判断
- Worker CPU 制限（50ms/無料、50ms-30s/有料）を踏まえ、**埋め込み生成はバッチ ingestion 時のみ**、クエリ時は retrieval のみに限定

---

## 測定指標（KPI）

1. **Retrieval Hit@8**: 人手ラベル済み 100 質問セットで、正答 KB が top-8 に含まれる率。現状推定 40-50% → 目標 85%+
2. **Groundedness Rate**: LLM 出力が注入 FAQ/KB 内の文字列を引用している率（n-gram overlap ≥ 30%）。現状測定不能 → 目標 70%+ で「推測回答」を検出
3. **Human Handoff Rate（AI 解決失敗率）**: 「担当者におつなぎ」系返答の割合 / 総会話数。現状 empty+filter fallback 合算で約 2-3%推定、真の「答えられなかった」率を別途計測 → 目標 現状比 -40%
