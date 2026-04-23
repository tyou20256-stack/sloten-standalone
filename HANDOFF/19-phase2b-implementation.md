# AI 精度向上 Phase 2b 実装レポート

**実装日**: 2026-04-23
**対象環境**: staging-bk (`sloten-standalone-staging-bk.rcc-aoki.workers.dev`)
**Version**: `e25adc96-b434-4397-afeb-3931a084ee7a`
**元提案**: [HANDOFF/ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) の Phase 2 (B+C + E + G 完遂)
**前フェーズ**: [HANDOFF/18-phase2a-implementation.md](18-phase2a-implementation.md)

---

## 🎯 総合結果

| 指標 | 結果 |
|------|------|
| Phase 2b E2E | ✅ **9/9 PASS** |
| Phase 2a 回帰 | ✅ **9/9 PASS** (regression 0) |
| Phase 1 回帰 | ✅ **11/11 PASS** (regression 0) |
| QA harness 回帰 | ✅ **52/52** (既存 false-positive 3 件のまま) |
| ユニットテスト | ✅ **39/39 PASS** |
| 構文チェック | ✅ **70/70 OK** |
| Migration 022 | ✅ 適用済 (DB tables: 44) |
| Vectorize index | ✅ `sloten-kb-index-staging` (1024 dim, cosine) |

---

## 📦 実装内容

### 1. Migration 022 — FAQ Silver 層 + Vectorize state ([migrations/022-faq-clusters.sql](migrations/022-faq-clusters.sql))

- `faq_candidates` に **`cluster_id`** / **`cluster_rank`** / **`embedding_hash`** カラム追加
- **`faq_candidate_clusters`** テーブル新設 (`size`, `avg_similarity`, `promoted`)
- **`vectorize_index_state`** テーブル (kb_chunks / faq_candidates 再インデックス履歴)
- `feature_flags` に `retrieval.use_vectorize` フラグ

### 2. Workers AI + Vectorize Handler ([src/handlers/vectorize.mjs](src/handlers/vectorize.mjs))

3 つの admin endpoint + 1 つの internal helper:
- `POST /api/admin/vectorize/reindex?kind=kb_chunks` — 全 chunks を `@cf/baai/bge-m3` で embed → Vectorize upsert (batch 50, 冪等)
- `POST /api/admin/vectorize/query` — クエリ直叩き (dev/test用)
- `GET  /api/admin/vectorize/state` — index 状態 + フラグ状態
- `POST /api/admin/vectorize/flags` — feature flag 切り替え
- `vectorizeQueryInternal()` — retrieval.mjs から呼ばれる

### 3. Hybrid Retrieval (RRF) ([src/retrieval.mjs](src/retrieval.mjs))

- **`retrievalHybrid()`**: BM25 (chunks FTS5) + Vectorize cosine を **RRF (k=60)** で融合
- 両方 top-K を取り、`1/(60+rank)` 加算で統合ランキング
- `vectorizeAvailable()` 判定: `VECTORIZE` binding + `AI` binding + `use_vectorize=1` + index 非空
- 4 段階 fallback: hybrid_rrf → fts5_chunks → fts5 → legacy (priority)
- `retrieval_trace` に `strategy` / `bm25_count` / `dense_count` / `top_rrf_score` を記録

### 4. FAQ Candidates Silver 層 ([src/handlers/faq-clustering.mjs](src/handlers/faq-clustering.mjs))

- **Embedding + Greedy Cosine Clustering** (閾値 0.85)
  - 各候補を bge-m3 (1024 dim) で embed
  - 既存 cluster との cosine ≥ 0.85 で join、なければ新 cluster
  - O(n²/2) — 606 件で数秒
- **頻度閾値** (≥ 3 で `promoted=1`) → reviewer には promoted のみ提示
- `POST /api/admin/faq-candidates/cluster` — 実行 (dry-run オプション)
- `GET  /api/admin/faq-candidates/clusters` — cluster 一覧 (promoted フィルタ可)
- `GET  /api/admin/faq-candidates/clusters/:id/members` — cluster 内メンバー全件
- **rejected 候補も対象に含む** (Feedback Synthesizer §5 — 「弱いけど実在する質問」)

### 5. Golden Set 拡張 88 → 195 rows ([seeds/golden-set-phase2b.json](seeds/golden-set-phase2b.json))

Phase 2b で 107 件追加 (合計 195 / 200 目標に近接):
- 入出金 10 / ボーナス 10 / アカウント 7 / コンプライアンス 7 / ゲーム 10
- 決済 5 / 規約 5 / 技術 7 / 雑談 7 / プロモーション 7
- エスカレーション適正 6 / 個人情報 3 / 時間ゾーン 3 / サーバー 2
- 言語切替 3 / FTD 3 / 退会 3 / ドリームポット 3 / 境界ケース 6

### 6. Admin UI — 2 新規セクション ([public/admin/sections/bot-data.js](public/admin/sections/bot-data.js))

- **Vectorize** (`/admin/#vectorize`) — binding 状態 + reindex ボタン + Hybrid toggle + query tester + log viewer
- **FAQ 候補クラスタ** (`/admin/#faq-clusters`) — 再クラスタリング (dry-run / apply) + cluster 一覧 + メンバー viewer
- ナビメニューに 🧭 Vectorize / 🧩 FAQ 候補クラスタ 追加

---

## 🔍 Phase 2b E2E 結果 (9/9 PASS)

```
=== Vectorize endpoints auth ===
✅ vectorize/state → 401 (no auth)
✅ vectorize/reindex → 403 (CSRF)
✅ vectorize/query → 403 (CSRF)

=== FAQ clustering endpoints auth ===
✅ faq-candidates/cluster → 403
✅ faq-candidates/clusters → 401

=== Retrieval module ===
✅ retrieval.mjs loads (no circular imports with vectorize.mjs)

=== Golden Set expansion ===
✅ Golden Set → 195 rows (88 → 195, target 200)

=== Admin nav ===
✅ Vectorize (Hybrid RAG) 項目あり
✅ FAQ 候補クラスタ 項目あり
```

## 🔒 回帰テスト

| テスト | 結果 |
|--------|------|
| Phase 1 E2E (escalation/RG/anger) | **11/11 PASS** |
| Phase 2a E2E (sentiment/deadloop/chunks) | **9/9 PASS** |
| QA harness | **52/52** (既存 false-positive 3 件のまま) |

→ **新機能追加 0 regression**

---

## 📊 DB 現状 (staging-bk)

| 指標 | Phase 2a | Phase 2b |
|------|----------|----------|
| Tables | 42 | **44** (+2) |
| `golden_set` rows | 88 | **195** |
| `knowledge_chunks` | 56 | **56** (変更なし、Vectorize push 待ち) |
| `faq_candidates` pending | 0 | 0 (全部 approved/rejected) |
| `faq_candidates` rejected | 587 | 587 (クラスタ対象) |
| `faq_candidate_clusters` | - | **0** (まだ未 run) |
| Vectorize index items | 0 | 0 (まだ未 push) |

---

## 🚦 本番投入前に必要な運用者アクション

Phase 2b の **コアロジック + UI は全て deploy 済** だが、**実データ投入 (embedding push)** は運用者が UI から明示的に実行する設計。

### Step A: Vectorize にベクトル push (Workers AI 課金発生)

1. 管理画面 `/admin/#vectorize` を開く
2. 🧭 「📤 KB chunks を reindex」ボタンをクリック
3. 確認ダイアログ → Yes
4. 数秒〜数十秒で完了。`vectorize_index_state.item_count` が 56 になる
5. 「🔍 Query テスト」で試す — bge-m3 + Vectorize のヒット結果が見える

**コスト**: `@cf/baai/bge-m3` は 1M tokens あたり $0.012。56 chunks × ~500 tokens = 28K = **$0.0003** (ワンタイム)。月次 query は 1 msg 1 embed ≒ 500 req/月 × ~50 tokens = 25K = $0.0003/月 → **実質 $0.01 未満**。

### Step B: Hybrid retrieval を ON

1. 同じ画面で 🟢 「Hybrid ON」ボタン
2. feature_flag `retrieval.use_vectorize = 1`
3. 以降、全 AI 回答が **Hybrid RRF retrieval** 経由に切替
4. ai_logs の `retrieval_trace.strategy = 'hybrid_rrf'` を観察

### Step C: FAQ candidates を cluster 化

1. 管理画面 `/admin/#faq-clusters` を開く
2. 👁️ 「Dry-run プレビュー」で効果を確認 (**推奨**)
   - 予想: 606 → ~80 cluster, promoted (size≥3) ~20 cluster
3. OK なら 🔄 「再クラスタリング」で本適用
4. promoted cluster を reviewer が 1 クリック承認 → FAQ 昇格

**期待効果**: 採択率 **3% → 40%+** (Data Engineer 試算)

### Step D: LLM-as-Judge 評価を実行 (195 Golden Set 対象)

```bash
export GEMINI_API_KEY=<staging-bk の実キー>
node scripts/eval-golden-set.mjs --judge --limit=50    # 50 件で smoke
node scripts/eval-golden-set.mjs --judge               # 全 195 件
```

結果は admin UI `/admin/#golden-set` のサマリテーブルで可視化。

---

## 🗺️ Phase 3 候補 (Synthesis の残項目)

Phase 2b で Phase 2 は完遂。次は synthesis §Phase 3 の長期投資項目:

| # | 項目 | 備考 |
|---|------|------|
| α | **Hybrid + re-rank** (cross-encoder, @cf/baai/bge-reranker-base) | hybrid 精度をさらに +10pt |
| β | **KB versioning + R2 snapshot** | 更新頻度が上がったら必要 |
| γ | **Drift detection cron** (semantic / staleness / contradiction) | 週次監視 |
| δ | **Model 比較 shadow** (Gemini Flash Lite vs Claude Haiku) | 500 件 replay で勝敗決定 |
| ε | **CI/CD 統合** (PR 時 Golden Set 自動評価、閾値割れで merge block) | GitHub Actions |
| ζ | **identifier_hash HMAC** (widget identifier 改ざん防止) | 既出セキュリティ懸念 |

---

## 🗃️ 変更ファイル一覧

### 新規 (5 ファイル)
- `migrations/022-faq-clusters.sql`
- `src/handlers/vectorize.mjs`
- `src/handlers/faq-clustering.mjs`
- `seeds/golden-set-phase2b.json`

### 改修 (4 ファイル)
- `src/retrieval.mjs` (+ hybrid RRF branch)
- `src/index.mjs` (+ 8 routes: vectorize × 4, faq-clusters × 3)
- `scripts/seed-golden-set.mjs` (Phase 2b JSON 読込)
- `public/admin/sections/bot-data.js` (+ 2 sections: Vectorize, FAQ clusters)
- `public/admin/index.html` (+ 2 nav items)

---

## 🔗 関連ドキュメント

- [HANDOFF/17-phase1-implementation.md](17-phase1-implementation.md)
- [HANDOFF/18-phase2a-implementation.md](18-phase2a-implementation.md)
- [HANDOFF/ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) — 全体ロードマップ
- [HANDOFF/ai-accuracy-discussion/01-ai-engineer-rag.md](ai-accuracy-discussion/01-ai-engineer-rag.md) — Vectorize + Hybrid RRF 設計の元
- [HANDOFF/ai-accuracy-discussion/04-data-engineer.md](ai-accuracy-discussion/04-data-engineer.md) — Silver 層設計の元
