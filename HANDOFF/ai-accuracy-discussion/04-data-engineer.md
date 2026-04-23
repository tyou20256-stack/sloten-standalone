# Data Engineer 視点: knowledge pipeline と FAQ 抽出品質

**エージェント**: Data Engineer
**視点**: chunking / embeddings / dedup / versioning / drift detection
**総合目的**: sloten-standalone の会話コーパス (37K+ messages) を高品質 KB に変換するデータパイプライン設計

---

## 1. 現状パイプライン欠陥 TOP 3

**① Dedup 不在 → ノイズ爆発:**
606 件の候補に意味的重複が大量混入。「入金方法は？」の表現違いが数十件並び、reviewer 疲弊で機械的 reject。

**② 頻度閾値なし:**
単発発言も候補化される設計。ロングテール質問が埋もれ、本当に頻出する FAQ が浮上しない。

**③ Silver 層欠落:**
messages(raw) → faq_candidates(gold 相当) に直行。cleansing/正規化/PII 除去/言い換え統合の中間層がなく、reviewer が人力で silver 相当の判断を強いられる。3.1% 採択率は抽出ロジック不良のシグナル。

---

## 2. Chunking 戦略

**採用**: manual_kb .md を chunk 化し Vectorize に投入すべき。RAG 精度は chunk 粒度で決まる。

- **粒度**: 300-500 tokens/chunk、日本語は 400 字目安
- **Overlap**: 15% (約 60 字) — 文脈断絶防止
- **分割単位**: Markdown heading (`##`) 優先 → 段落 → 文。heading 横断禁止
- **メタデータ (D1 `knowledge_chunks`)**: `source_id, heading_path, chunk_idx, token_count, content_hash(sha256), embedding_model, embedding_version, created_at`
- **Embedding**: **Workers AI `@cf/baai/bge-m3`(1024dim, 多言語)** を第一候補。Gemini `text-embedding-004` は API レイテンシ + コスト増。Vectorize は Workers AI とゼロレイテンシ統合

---

## 3. FAQ 候補抽出の品質向上

**3 段パイプライン化:**

### Bronze (raw 抽出)
現状 extractor.mjs 出力

### Silver (正規化 + dedup)
- 各候補を bge-m3 で embedding
- **HDBSCAN or cosine ≥0.88 で cluster 化** → cluster 代表のみ残す
- **頻度閾値**: cluster size ≥3 のみ昇格 (1 回のみ発生は破棄)
- PII 正規化 (口座番号/金額 → プレースホルダ)

### Gold (reviewer 提示)
cluster 代表 + 出現回数 + 代表会話 3 件を UI に同梱。reviewer は「1 クリック承認」可能に

**期待効果**: 606 → 80 件程度に圧縮、採択率 3% → 40%+

---

## 4. KB Freshness (Drift Detection)

**週次 cron で 3 指標を監視:**

- **Semantic drift**: 直近 7 日の顧客質問 embeddings を既存 KB chunks と cosine 比較。`max_sim < 0.72` な質問が週 N 件超えたら Slack 通知 (= KB 未カバー)
- **Staleness**: `knowledge_sources.updated_at > 30日` かつ該当トピックへの新規質問あり → 更新候補
- **Contradiction**: 同一 cluster 内で KB 回答と実オペレータ回答が diverge → 手動レビュー flag

D1 に `kb_drift_events` テーブル新設 (drift_type, source_id, detected_at, evidence_conversation_ids)

---

## 5. バージョニング

D1 は追記ログ方式が軽量:

```sql
CREATE TABLE knowledge_sources_history (
  id INTEGER PRIMARY KEY,
  source_id INTEGER,
  version INTEGER,
  content_hash TEXT,
  diff_summary TEXT,
  changed_by TEXT,
  changed_at TEXT,
  operation TEXT  -- create/update/delete
);
```

- `knowledge_sources` 更新時に trigger で旧 row を history へコピー
- **R2 に full snapshot 保存**: `r2://kb-snapshots/{source_id}/{version}.md` — D1 サイズ肥大回避
- **Rollback**: `UPDATE knowledge_sources SET content=(R2から取得), version=version+1 WHERE id=?` + history 追記
- Admin UI に diff viewer (2 バージョン比較) 追加

---

## 6. 実装順序

**依存グラフ**: embeddings → (chunking, dedup) → drift → versioning

| Week | 内容 |
|------|------|
| 1 | versioning 基盤 (history table + R2 snapshot) — 他より先に入れないと後工程の変更を追跡不能 |
| 2 | Workers AI embedding + Vectorize index 作成、manual_kb chunking バッチ (一回実行で 11 ファイル → 約 150 chunks 予想) |
| 3 | faq_candidates 既存 606 件を遡及 embedding → cluster 化バッチ (Silver 層構築、reviewer UI 拡張) |
| 4 | extractor.mjs 改修 — 新規候補は頻度閾値 + cluster 経由のみ生成 |
| 5 | drift detection cron 投入、`kb_drift_events` 可視化 |

**先行条件**: Vectorize index は dimension 固定なので bge-m3 (1024) で確定してから全 embedding 生成 (やり直しコスト大)。

---

## 関連ファイル

- `scripts/extract-faqs-from-messages.mjs`
- `src/extractor.mjs`
- `knowledge-base/*.md` (11 ファイル)
- `src/handlers/faq-candidates.mjs`
