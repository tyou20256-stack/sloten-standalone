# AI 精度向上 Phase 2a 実装レポート

**実装日**: 2026-04-23
**対象環境**: staging-bk (`sloten-standalone-staging-bk.rcc-aoki.workers.dev`)
**Version**: `61cc9b99-27ce-4dab-b673-fcf29acbb93b`
**元提案**: [HANDOFF/ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) の Phase 2 (D, E, F, H + B 準備)
**前フェーズ**: [HANDOFF/17-phase1-implementation.md](17-phase1-implementation.md)

---

## 🎯 総合結果

| 指標 | 結果 |
|------|------|
| Phase 2 E2E | ✅ **9/9 PASS** |
| Phase 1 E2E 回帰 | ✅ **11/11 PASS** (regression 0) |
| QA harness 回帰 | ✅ **52/52** (既存 false-positive 3 件のまま) |
| ユニットテスト | ✅ **39/39 PASS** |
| 構文チェック | ✅ **68/68 OK** |
| Migration 020/021 | ✅ 適用済 |
| Workers AI / Vectorize binding | ✅ **有効化済** |
| Vectorize index | ✅ `sloten-kb-index-staging` 作成済 |

---

## 📦 実装内容

### 1. Migration 020 — Shadow Mode 基盤 ([migrations/020-shadow-mode.sql](migrations/020-shadow-mode.sql))

- `ai_logs` に **`is_shadow`** / **`shadow_of`** / **`judge_score`** カラム追加
- **`golden_eval`** テーブル新設 (LLM-as-Judge 結果 + キーワード評価の履歴)
- `feature_flags` に shadow mode フラグ追加 (`ai.shadow_mode.enabled`, `ai.shadow_mode.prompt_ids`)

### 2. Migration 021 — Knowledge Chunks ([migrations/021-knowledge-chunks.sql](migrations/021-knowledge-chunks.sql))

- `knowledge_chunks` に `heading_path` / `token_count` / `content_hash` / `embedding_model` / `embedding_version` / `vectorize_id` カラム追加
- **`kb_chunks_fts`** 仮想テーブル + 同期トリガー (FTS5 BM25 で chunk-level retrieval)
- `feature_flags` に `retrieval.use_chunks` フラグ

### 3. Shadow Mode ([src/shadow.mjs](src/shadow.mjs))

- `scheduleShadowCalls()`: primary prompt の応答後、候補プロンプト最大 2 本を **`ctx.waitUntil`** で並列実行
- ユーザー応答レイテンシに影響なし
- 候補結果を `ai_logs` に `is_shadow=1, shadow_of=<primary_id>` で記録 → 後から pairwise 比較可能
- feature_flag でオンオフ制御 (**デフォルト OFF** — LLM コスト 2-3x 化のため)

### 4. Sentiment + Dead-loop 拡張 ([src/escalation.mjs](src/escalation.mjs))

- `scoreSentiment()` — 日本語感情辞書 (NEG 25 語 + POS 10 語) ベースのスコアリング
- `decideEscalation()` に新規 2 パターン追加:
  - **`negative_sentiment`**: score ≤ -2 の怒り/不満系入力 → 即エスカレ
  - **`deadloop_full`**: character bigram Jaccard ≥ 0.5 OR 4-6 文字 CJK 共通トピック検出 → エスカレ
- ASCII-only button payloads (`deposit_withdrawal` 等) は CJK 必須で除外 (誤検出防止)

### 5. Workers AI + Vectorize Bindings ([wrangler.staging-bk.toml](wrangler.staging-bk.toml))

- `[ai] binding = "AI"` — Workers AI (埋め込み / 推論、将来用)
- `[[vectorize]] binding = "VECTORIZE"` — index `sloten-kb-index-staging` (1024dim, cosine)
- ✅ Vectorize index 作成済み (`wrangler vectorize create --dimensions=1024 --metric=cosine`)

### 6. Knowledge Chunking ([scripts/chunk-knowledge.mjs](scripts/chunk-knowledge.mjs))

- Markdown heading 優先 → 段落 → 文字数上限 400 字 (15% overlap) で chunk 分割
- content_hash (sha256) 付き、冪等再実行可
- **56 chunks** を 23 sources から生成
- 各 chunk に heading_path prefix を付与 (retrieval signal)
- Vectorize 埋め込み生成は Phase 2b で有効化 (`--embed` オプション準備済)

### 7. Retrieval — Chunks FTS5 対応 ([src/retrieval.mjs](src/retrieval.mjs))

- `chunksAvailable()` — `retrieval.use_chunks=1` かつ chunks 存在で有効
- 有効時、`kb_chunks_fts` で BM25 top-K 取得 (document-level より精度高)
- `retrieval_trace.strategy = 'fts5_chunks'` で記録

### 8. Golden Set 拡張 30 → 88 件

- [seeds/golden-set-phase2.json](seeds/golden-set-phase2.json) に 58 件追加 (入出金/ボーナス/アカウント/コンプラ/ゲーム/決済/規約/技術/雑談/エスカレーション適正)
- Phase 1 の 30 + Phase 2 の 58 = **88 件** seeded
- Phase 2b で 200 件目標 (synthesis で想定の完全 Golden Set)

### 9. LLM-as-Judge Eval Script ([scripts/eval-golden-set.mjs](scripts/eval-golden-set.mjs))

- 全 active prompts × Golden Set corpus を Gemini 直叩きで評価
- メトリクス 4 種:
  - Keyword Inclusion Score (0..1)
  - Must-not-contain Violations (count)
  - Expected Escalation Match (0/1)
  - LLM-as-Judge score (1..5, `--judge` オプション)
- 結果を `golden_eval` テーブルに batch_id 付きで保存 → admin UI で可視化

### 10. 3 段エスカレ UX Prompt ([scripts/seed-phase2-prompts.mjs](scripts/seed-phase2-prompts.mjs))

- 新 prompt **`default-C-tiered`** (weight=0, 初期は inactive)
- UX Researcher §4 の「Level 1: 部分回答 → Level 2: 代替情報 → Level 3: 人間」を system prompt に明示
- 80-150 字目安、過剰約束禁止、景表法 NG ワード明記
- 運用者が admin UI で weight 調整して A/B 投入可

### 11. Golden Set CRUD ([src/handlers/golden-set.mjs](src/handlers/golden-set.mjs))

- `GET/POST/PATCH/DELETE /api/golden-set`
- `GET /api/golden-eval` — 直近 30 日 prompt 別評価サマリ
- `GET/POST /api/admin/shadow-config` — shadow mode 設定

### 12. Admin UI 3 セクション追加 ([public/admin/sections/bot-data.js](public/admin/sections/bot-data.js))

- **Golden Set** (`/admin/#golden-set`) — カテゴリ別テーブル + エディタ + 評価結果サマリ
- **Shadow Mode** (`/admin/#shadow-settings`) — 有効化トグル + prompt ID 設定
- `bot-data.js` 既存セクションは変更なし

---

## 🔍 Phase 2 E2E 結果 (9/9 PASS)

```
=== Phase 2: Sentiment-based escalation (negative_sentiment) ===
✅ "意味不明です最悪ひどい" → 「ご不快な思いを...」
✅ "なんでこんなに遅いんだ使えない" → 「ご意見ありがとうございます...」

=== Phase 2: Dead-loop (similarity-based) ===
✅ 3 パスワード関連質問 → 「同様のご質問が続いているようです...」
    (CJK topic "パスワード" 検出)

=== Phase 2: FTS5 chunks retrieval ===
✅ retrieval_trace.strategy='fts5_chunks' で chunks 経由で動作

=== Phase 2: Golden Set / Shadow API ===
✅ 認証なしで全て 401

=== Phase 2: Sentiment unit tests ===
✅ ネガ 3 語 → -3
✅ ポジ 2 語 → +2
✅ ニュートラル → 0
```

## 🔒 既存機能回帰 (no regression)

- **Phase 1 E2E**: 11/11 PASS (escalation / RG / anger / over-promise filter すべて維持)
- **QA harness**: 52/52 PASS (3 件は既存 false-positive: PayPay 応答/gatorian キーワード/CORS example.com)

---

## 📊 DB 現状 (staging-bk)

| 指標 | 値 |
|------|------|
| Tables | **42** (Phase 1 は 36、+6) |
| `golden_set` rows | **88** (Phase 1: 30 + Phase 2: 58) |
| `knowledge_chunks` | **56** chunks (23 sources から) |
| `ai_prompts` active | **3** (default-A/B + C-tiered weight=0) |
| Vectorize index | `sloten-kb-index-staging` (created, empty) |
| feature_flags 新規 | `ai.shadow_mode.enabled`, `ai.shadow_mode.prompt_ids`, `retrieval.use_chunks` |

---

## 🗺️ Phase 2b (次回) 残項目

synthesis §Phase 2 の未着手項目:

| # | 項目 | 備考 |
|---|------|------|
| B+C | **Vectorize embeddings 実投入** | `chunk-knowledge.mjs --embed` で 56 chunks を bge-m3 で埋め込み → Vectorize にアップロード。retrieval.mjs に vectorize path 追加 |
| E | **Golden Set 200 件拡張 + reference_answer 記入** | 88 → 200 件は運用者レビュー前提 |
| G | **faq_candidates Silver 層** | embedding cluster + 頻度閾値で 606 → ~80 に圧縮、採択率 3% → 40%+ |

### Phase 2b 実行条件
1. Workers AI が有効化されている Cloudflare アカウント (課金 $5-15/月想定)
2. `npm run eval:golden -- --judge` を 1 回実行してベースライン取得
3. 運用者が Golden Set の reference_answer を記入 (今 88 件中ゼロ)

---

## 🎛️ 運用者アクション (Phase 2a 投入後)

### A. Shadow Mode を試したい場合
```sql
-- ai_prompts で default-C-tiered の id を確認 (例: id=3)
SELECT id, name FROM ai_prompts WHERE is_active = 1;

-- admin UI (/admin/#shadow-settings) or SQL で設定
UPDATE feature_flags SET value='1' WHERE key='ai.shadow_mode.enabled';
UPDATE feature_flags SET value='3' WHERE key='ai.shadow_mode.prompt_ids';
```

以後、primary response は A または B (従来 50/50) で返りつつ、C-tiered も並列実行され ai_logs に is_shadow=1 で記録される。後から pairwise 比較可能。

### B. Chunks retrieval を有効化
```sql
UPDATE feature_flags SET value='1' WHERE key='retrieval.use_chunks';
```
既に staging-bk は ON 済。本番で有効化する前に `node scripts/chunk-knowledge.mjs --apply` を実行して chunks を populated しておくこと。

### C. LLM-as-Judge 評価を実行
```bash
export GEMINI_API_KEY=<staging-bk の実キー>
node scripts/eval-golden-set.mjs                    # keyword + mustnot のみ
node scripts/eval-golden-set.mjs --judge --limit=20 # LLM judge も
```
結果は `golden_eval` テーブル。Admin UI `/admin/#golden-set` のサマリで可視化。

### D. Phase 2 C-tiered prompt を A/B 投入
```sql
UPDATE ai_prompts SET weight = 30 WHERE name = 'default-C-tiered';
UPDATE ai_prompts SET weight = 35 WHERE name IN ('default-A-detailed','default-B-concise');
```
これで 3 prompt が 30/35/35 でトラフィック分割 → 2 週間観測 → Golden Set 評価で勝者判定。

---

## 🗃️ 変更ファイル一覧

### 新規 (7 ファイル)
- `migrations/020-shadow-mode.sql`
- `migrations/021-knowledge-chunks.sql`
- `src/shadow.mjs`
- `src/handlers/golden-set.mjs`
- `scripts/chunk-knowledge.mjs`
- `scripts/eval-golden-set.mjs`
- `scripts/seed-phase2-prompts.mjs`
- `seeds/golden-set-phase2.json`

### 改修 (6 ファイル)
- `src/escalation.mjs` (+ sentiment + dead-loop with CJK guard)
- `src/retrieval.mjs` (+ chunks FTS5 branch)
- `src/ai-chat-adapter.mjs` (+ scheduleShadowCalls)
- `src/handlers/ai-logs.mjs` (recordAiCall: is_shadow/shadow_of 対応 + primaryLogId return)
- `src/index.mjs` (+ 6 routes: golden-set CRUD, shadow-config, golden-eval)
- `scripts/seed-golden-set.mjs` (Phase 2 JSON 読込追加)
- `wrangler.staging-bk.toml` (+ ai + vectorize bindings)
- `public/admin/sections/bot-data.js` (+ 3 sections: Golden Set editor, Shadow settings)
- `public/admin/index.html` (+ 2 nav items)

---

## 🔗 関連ドキュメント

- [HANDOFF/17-phase1-implementation.md](17-phase1-implementation.md) — Phase 1 実装レポート
- [HANDOFF/ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) — 7 専門家議論
- [HANDOFF/ai-accuracy-discussion/03-experiment-tracker.md](ai-accuracy-discussion/03-experiment-tracker.md) — Shadow mode 設計の元
- [HANDOFF/ai-accuracy-discussion/04-data-engineer.md](ai-accuracy-discussion/04-data-engineer.md) — Chunking 戦略の元
- [HANDOFF/ai-accuracy-discussion/07-support-responder.md](ai-accuracy-discussion/07-support-responder.md) — Sentiment / dead-loop 設計の元
- [HANDOFF/ai-accuracy-discussion/06-ux-researcher.md](ai-accuracy-discussion/06-ux-researcher.md) — 3-tier escalation prompt の元
