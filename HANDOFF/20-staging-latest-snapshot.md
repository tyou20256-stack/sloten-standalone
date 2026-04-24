# ステージング環境 最新状態スナップショット

**日時**: 2026-04-24 (Chatbot 13 Fix 適用後)
**対象環境**: staging-bk (`sloten-standalone-staging-bk.rcc-aoki.workers.dev`)
**Worker Version**: `e7557570-29f7-4ed9-a089-adbe4aac5d7e`
**Git HEAD**: `077699d`
**ブランチ**: main (origin より 8 commits 先行、未 push)

---

## 🎯 総合判定

| 項目 | 状態 |
|------|------|
| コード | ✅ 最新 commit 済、staging-bk にデプロイ済 |
| DB schema | ✅ migrations 015→022 全適用済 (全 44 tables) |
| seed データ | ✅ bonus_codes 25 / golden_set 195 / knowledge_chunks 56 |
| 全テスト | ✅ 39+11+9+9 PASS / 52/55 QA harness (legacy 3) |
| 運用者未実行 | ⚠️ Vectorize reindex / Hybrid ON / FAQ cluster / LLM-as-Judge |

---

## 📋 最新 Commit 履歴 (本フェーズまで)

```
077699d feat(widget+flow): 13 chatbot fixes from sloten-chatbot-fix-instructions.md
92bd203 feat(manual): add HTML operations manual + init-admin staging-bk support
7c6f617 docs(handoff): add 20-staging-latest-snapshot.md
bad0743 docs(handoff): Phase 1-2b reports + 7-agent AI accuracy discussion + admin UI sections
f91302c feat(ai): Phase 1+2a+2b AI accuracy improvements
bbccabc feat(flow+widget): ATM deposit handoff + widget setUser (Chatwoot $chatwoot.setUser parity)
da50603 feat(migrations): add 018-022 for AI accuracy + FTS5 + shadow + chunks + FAQ clusters
69597c6 docs(handoff): add migration verification + chatwoot freeze + hybrid map + GAS SOP
d2b34f0 feat(bonus): add heavenday_daachin + regenerate sloten-main flow seed
```

※ `git push origin main` は **未実行** — 必要に応じて user 判断。

---

## 🗄️ DB スナップショット (staging-bk, 2026-04-23)

| テーブル | 件数 |
|---------|------|
| bonus_codes (tenant_default) | **25** |
| bot_flows (tenant_default) | **6** |
| golden_set | **195** |
| knowledge_chunks | **56** |
| kb_chunks_fts | **56** |
| faq_fts | 47 (既存 FAQ と同期) |
| kb_fts | 23 (knowledge_sources と同期) |
| faq_candidate_clusters | **0** (user が cluster ボタン押下で生成) |
| Vectorize index items | **0** (user が reindex ボタン押下で push) |
| ai_prompts active | **3** (default-A/B/C-tiered) |

### feature_flags 現状

| key | value | 用途 |
|-----|-------|------|
| `ai.shadow_mode.enabled` | `0` | Phase 2a shadow mode — OFF |
| `ai.shadow_mode.prompt_ids` | `""` | shadow 対象 prompt ID |
| `retrieval.use_chunks` | `1` | Phase 2a chunks 経由 — **ON** |
| `retrieval.use_vectorize` | `0` | Phase 2b Hybrid RRF — OFF |

---

## 🆕 本日追加 (2026-04-24)

### Chatbot Widget 13 Fixes ([HANDOFF/21-chatbot-fix-implementation.md](21-chatbot-fix-implementation.md))

**Critical (4)**:
- ✅ **Fix 1**: Select step で自由テキスト入力 → AI が回答 + メニュー再表示 (最重要)
- ✅ Fix 2: ボタンクリック時に label 表示 (内部 value `game_info` 非表示)
- ✅ Fix 3: Bot 回答に Markdown (太字/URL/改行) レンダリング
- ✅ Fix 4: 「接続中」常時表示の修正 (WS open で hide)

**High (4)**:
- ✅ Fix 5: per-message タイムスタンプ
- ✅ Fix 6: ドリームポットバナー sticky 固定
- ✅ Fix 7: スムーズ自動スクロール
- ✅ Fix 8: 時間帯挨拶 (朝/昼/夜)

**Medium (5)**:
- ✅ Fix 9: オペレーター対応時間外案内
- ✅ Fix 10: ファイル添付バリデーション (JPG/PNG/GIF/WEBP/PDF, 5MB)
- ✅ Fix 11: ブランドロゴ設定 (optional)
- ✅ Fix 12: Esc キーで閉じる
- ✅ Fix 13: Tab フォーカストラップ

### 管理画面マニュアル HTML
- ✅ `https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/manual/` — 32 セクション公開

---

## ✅ 実装済 機能一覧

### Chatwoot-like parity (setUser)
- ✅ `window.SlotenChat.setUser(identifier, userInfo)` widget API
- ✅ `PATCH /api/widget/contacts/:id` runtime update
- ✅ Operator UI 右サイドバー「識別子」行表示

### Bot Flow
- ✅ 6 handoffs 対応 (PayPay / Bank / **ATM** / EC + transfer_to_agent + bonus code)
- ✅ sloten-main flow 109 steps (ATM 含む)
- ✅ 25 bonus codes (heavenday_daachin 含む)
- ✅ 4 GAS webhook URL allowlist (env_overrides 経由ローテ可)

### AI accuracy — Phase 1 (safety + 測定基盤)
- ✅ Escalation gate (HARD_KW / RG / Anger / Dead-loop / Negative sentiment — 5 カテゴリ)
- ✅ 過剰約束 soft-mask (必ず/絶対/100%/24時間以内/etc — 10 パターン)
- ✅ RG 相談窓口固定文言 (依存症兆候検出時)
- ✅ Silent-failure SQL view 3 種
- ✅ `ai_logs` に tokens + retrieval_trace + escalation_reason 記録
- ✅ Admin UI: 👍/👎/⚠️ ワンクリックフィードバック

### AI accuracy — Phase 2a (実験基盤 + 深さ)
- ✅ **Shadow mode** (ctx.waitUntil parallel prompt evaluation、feature_flag 制御)
- ✅ Knowledge chunking (56 chunks from 23 sources, 400 char + 15% overlap)
- ✅ D1 FTS5 BM25 retrieval (chunk-level 優先)
- ✅ Sentiment scoring (NEG 25 + POS 10 日本語辞書)
- ✅ Dead-loop 検出 (Jaccard + CJK topic word)
- ✅ 3 段階エスカレ UX prompt (`default-C-tiered`, weight=0 で待機)
- ✅ Golden Set 88 rows + LLM-as-Judge eval script

### AI accuracy — Phase 2b (Hybrid retrieval + FAQ Silver)
- ✅ Workers AI `@cf/baai/bge-m3` + Vectorize binding
- ✅ `POST /api/admin/vectorize/reindex|query|state|flags`
- ✅ **Hybrid retrieval (BM25 + Vectorize + RRF)** 4-tier fallback
- ✅ FAQ candidates Silver 層 (cosine 0.85 + frequency ≥ 3)
- ✅ Golden Set 195 rows (目標 200 の 97.5%)

### Admin UI
- ✅ 10 セクション追加 (Phase 1-2b 全機能カバー):
  - 📝 AI回答ログ (👍/👎/⚠️)
  - 🔕 AI サイレント失敗 (3 タブ)
  - ⭐ Golden Set エディタ + 評価サマリ
  - 👥 Shadow Mode 設定
  - 🧭 Vectorize (reindex / Hybrid ON-OFF / query test)
  - 🧩 FAQ 候補クラスタ (dry-run + apply)

---

## ⚠️ 運用者が staging-bk で実行できる操作 (Phase 2b 以降)

Phase 2a/2b の **コア機能は deploy 済だが、実データ投入は UI 経由で明示的に** 実行する設計。

### A. Vectorize に embeddings push

1. `/admin/#vectorize`
2. 📤 「KB chunks を reindex」クリック
3. 数十秒で 56 chunks が Vectorize index に push
4. コスト: 約 **$0.0003** (ワンタイム、`@cf/baai/bge-m3` 28K tokens)

### B. Hybrid retrieval を ON

1. `/admin/#vectorize` で 🟢 「Hybrid ON」クリック
2. `feature_flags.retrieval.use_vectorize = 1`
3. 次回の全 AI 回答が hybrid_rrf 経由

### C. FAQ candidates Silver 層 実行

1. `/admin/#faq-clusters`
2. 👁️ Dry-run で効果確認 (606 candidates → 予想 ~80 clusters)
3. 🔄 再クラスタリングで本適用
4. promoted cluster (≥ 3 size) のみ reviewer に提示

### D. LLM-as-Judge で Golden Set 評価

```bash
export GEMINI_API_KEY=<staging-bk secret の値>
node scripts/eval-golden-set.mjs --judge --limit=30
```

結果は `/admin/#golden-set` の summary table で可視化。

### E. 3-tier prompt A/B 投入

```sql
-- Admin UI /admin/#prompts or 直 SQL
UPDATE ai_prompts SET weight = 30 WHERE name = 'default-C-tiered';
UPDATE ai_prompts SET weight = 35 WHERE name IN ('default-A-detailed','default-B-concise');
```
→ 3 prompt が 30/35/35 で分割、2 週間観測後 Golden Set で勝敗判定。

---

## 🔗 関連 HANDOFF ドキュメント

### 本番投入準備
- [02-deploy-runbook.md](02-deploy-runbook.md) — デプロイ手順
- [12-chatwoot-freeze-decision.md](12-chatwoot-freeze-decision.md) — chatwoot-final-working 凍結判断
- [14-gas-update-sop.md](14-gas-update-sop.md) — GAS 更新 SOP

### AI accuracy 系
- [ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) — 7 専門家統合ロードマップ
- [17-phase1-implementation.md](17-phase1-implementation.md) — Phase 1 (安全 + 測定)
- [18-phase2a-implementation.md](18-phase2a-implementation.md) — Phase 2a (shadow + chunks + sentiment)
- [19-phase2b-implementation.md](19-phase2b-implementation.md) — Phase 2b (Vectorize + Hybrid + Silver)

### サイト統合
- [16-sloten-site-integration.md](16-sloten-site-integration.md) — widget 埋込 + setUser 連携
- [13-hybrid-dependency-map.md](13-hybrid-dependency-map.md) — sloten ↔ GAS 責任分担

---

## 🧪 テスト結果 (2026-04-23)

| テストスイート | 結果 |
|---------------|------|
| `npm test` | **39/39 PASS** |
| `npm run check:all` (syntax) | **70/70 OK** |
| Phase 1 E2E (escalation/RG/anger/over-promise) | **11/11 PASS** |
| Phase 2a E2E (sentiment/deadloop/chunks/golden/shadow) | **9/9 PASS** |
| Phase 2b E2E (vectorize auth/faq-clusters auth/golden 195/nav) | **9/9 PASS** |
| QA harness (セキュリティ + ボット動作) | **52/55 PASS** (legacy 3 false-positives のみ) |

---

## 🚦 次のマイルストーン候補

### 1. 本番投入準備
- 本番 D1 に migrations 018-022 を適用 (現状 staging-bk のみ)
- 本番 Worker に deploy
- CORS allowlist を本番 URL に更新

### 2. Phase 3 候補 (synthesis §Phase 3 — 長期投資)
- Hybrid + cross-encoder rerank (`@cf/baai/bge-reranker-base`)
- KB versioning + R2 snapshot (drift detection)
- Model 比較 shadow (Gemini Flash Lite vs Claude Haiku)
- CI/CD 統合 (PR 時 Golden Set 自動評価、閾値割れで merge block)
- identifier_hash HMAC (widget identifier 改ざん防止)

### 3. 運用者が staging-bk で即実施可能
- Vectorize reindex → Hybrid ON
- FAQ candidates cluster 化
- LLM-as-Judge 評価実行
- 3-tier prompt A/B 投入

---

## 📂 本日追加したファイル合計

| 種別 | 件数 |
|------|------|
| 新規 src | 6 (escalation / retrieval / shadow / 3 handlers) |
| 新規 scripts | 4 (chunk-knowledge / eval-golden / seed-golden / seed-phase2-prompts) |
| 新規 migrations | 5 (018-022) |
| 新規 seeds | 2 (golden-set-phase2.json, -phase2b.json) |
| 新規 HANDOFF | 13 (15-19 + ai-accuracy-discussion × 8) |
| 改修 src | 6 |
| 改修 admin UI | 2 |

**Total**: 38 ファイル新規/改修。
