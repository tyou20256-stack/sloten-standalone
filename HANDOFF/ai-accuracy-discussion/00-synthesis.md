# AI 自動回答精度向上 — 7 専門家議論 統合 Synthesis

**実施日**: 2026-04-23
**参加エージェント**: 7 名 (AI Engineer / Model QA Specialist / Experiment Tracker / Data Engineer / Feedback Synthesizer / UX Researcher / Support Responder)
**対象**: sloten-standalone の Gemini 2.5 Flash Lite 自動回答精度

---

## 🎯 Executive Summary

現状の sloten-standalone AI システムは「動いているが測定できていない」状態。可用性 98.5% (407/413) だが **正答率は誰も知らない**。

**全専門家一致の問題認識:**
1. **測定基盤不在** (Grounding / Accuracy / Compliance 違反 / フィードバックの全てが盲目)
2. **RAG が実は RAG ではない** (priority ソート top-15 のみで意味的マッチング皆無)
3. **評価なき A/B** (4 プロンプト動いてるが勝者決まらず、2 本は test 残骸)

**最優先アクション 3 つ (全員が Phase 1 に入れた項目):**
1. 汚染 A/B プロンプト 2 本 (`oor`, `oor-1145`, body="x") を **即刻無効化**
2. **ai_log_feedback ワンクリック UI** (👍/👎/⚠️) + Slack 通知で運用者の feedback 流入を始める
3. **Compliance 出力フィルタ** (過剰約束ワード + RG/依存症対応固定文言) — 事故前に防ぐ

---

## 🤝 7 人の合意事項 (コンセンサス)

| 論点 | 合意内容 | 支持エージェント |
|------|----------|------------------|
| Golden Set は必須 | 200 件で MVP、評価と CI gate の基盤 | Model QA, Experiment Tracker, Data Eng |
| ハードコード安全フィルタ優先 | コンプライアンス違反は AI 出力後の正規表現で cutoff | Model QA, Support Responder |
| Silent 失敗ログを掘る | 明示 feedback 不要、behavioral signal で失敗検出 | Feedback, UX, Support |
| 「担当者おつなぎ」ブランケットは UX 破綻 | 3 段階エスカレ + 理由コード付きに置換 | UX, Support |
| Gemini Flash Lite は初期 fit | モデル交換より RAG/prompt/フィルタ改善が先 | AI Eng, Experiment Tracker |
| 607→47 (3%) の FAQ 採択率は抽出ロジックの問題 | reviewer の目でなく dedup/clustering/頻度閾値で 解決 | Data Eng, Feedback |

---

## ⚔️ 視点の対立・トレードオフ

### 対立 1: Prompt Tone — 詳細 vs 簡潔

| 視点 | 立場 |
|------|------|
| UX Researcher | **中間が正解**: 80〜150 字、結論→改行→詳細。現行 2 プロンプトは両方 UX 欠陥 |
| Support Responder | **感情質問は必ず長め・温かめ**。怒り顧客に短文は火に油 |
| AI Engineer | **retrieval が弱いから長文で補っている**。chunk + rerank で密度上げれば短文で足りる |

**統合解**: 文脈判定分岐 (金銭質問は厳密、感情質問は共感ベース、情報質問は簡潔)。プロンプト単一化ではなく `prompt_variant` 列で用途別管理。

### 対立 2: 顧客側 👍👎 配置

| 視点 | 立場 |
|------|------|
| Feedback Synthesizer | **置く** (1 セッション最大 1 回、疲労回避) |
| UX Researcher | **置かない** (Re-query Rate などの行動指標で代替可) |

**統合解**: Phase 1 は配置しない (Re-query / Escalation 後などの behavioral signal で計測)。Phase 2 で選択的配置 (closure 直前のみ、任意)。

### 対立 3: Escalation Rate 目標

| 視点 | 立場 |
|------|------|
| Support Responder | **25-35% が理想**。現状 19% は取りこぼしの疑い |
| UX Researcher | **Resolution Rate 65%+ (= escalation 35%)** が目標 |
| AI Engineer | 絶対値より **Groundedness Rate 70%+** を先に達成すべき |

**統合解**: 両立可能。Phase 1 で不安な領域 (金銭/RG) は積極エスカレ → escalation 一時的に上昇許容。Phase 2 で Groundedness 向上 + 安全圏は AI 解決 → Phase 3 で 25-30% 帯に収束。

### 対立 4: Chunking の緊急度

| 視点 | 立場 |
|------|------|
| Data Engineer | **Week 1 で versioning 基盤 → Week 2 で chunking** |
| AI Engineer | **FTS5 BM25 を先に** (工数 S、chunking より即効性あり) |
| Experiment Tracker | **測定基盤が先**、さもなくば chunking 効果も測れない |

**統合解**: FTS5 + Golden Set + feedback UI を並行で week 1、chunking は week 2-3。versioning は更新頻度が低ければ後回し可 (現状 KB 更新は月 1-2 回ペース)。

---

## 🗺️ 統合ロードマップ

### Phase 1: Quick Wins (今週〜来週、工数合計 ~5-7 人日)

| # | アクション | 責任視点 | 工数 | 期待効果 |
|---|-----------|---------|------|---------|
| 1 | 汚染 A/B prompt (oor/oor-1145) 無効化 | Experiment Tracker | 5分 | `default-A/B` サンプル 100% に |
| 2 | 出力フィルタに **過剰約束ワード禁止** 追加 (必ず/絶対/100%/〜円もらえます) | Support Responder | 0.5 日 | 景表法違反 0 件/週 |
| 3 | 依存症固定文言 (hardcode) + RG 相談窓口導線 | Support Responder | 0.5 日 | RG 責任クリア |
| 4 | `ai_log_feedback` ワンクリック UI (👍/👎/⚠️) + 日次サマリ | Model QA, Feedback | 1 日 | feedback 率 0% → 20%+ |
| 5 | Silent 失敗 SQL ビュー 3 種 (即エスカレ / 再質問 / 怒りワード) | Feedback Synthesizer | 0.5 日 | 失敗の週次抽出 |
| 6 | `tokens_in/out` + `prompt_id` + `retrieval_trace` を ai_logs に記録 | AI Engineer | 0.5 日 | 測定基盤 |
| 7 | Golden Set v0.1 (50 件) 投入 + 夜間 eval バッチ | Model QA | 1.5 日 | プロンプト勝敗可視化 |
| 8 | ハードエスカレ辞書 (返金/訴える/退会) + 理由コード実装 | Support Responder | 1 日 | 取りこぼし防止 |

### Phase 2: 構造改善 (3-6 週間、工数合計 ~3-4 人週)

| # | アクション | 責任視点 | 工数 | 期待効果 |
|---|-----------|---------|------|---------|
| A | **D1 FTS5 BM25 retrieval** (priority → 意味的関連度) | AI Engineer | 2 日 | Hit@8 40% → 70%+ |
| B | **knowledge_chunks 生成** (manual_kb 11 files → ~150 chunks) | Data Engineer | 3 日 | 情報欠落型エラー削減 |
| C | **Workers AI bge-m3 embeddings + Vectorize** | Data Engineer + AI Eng | 5 日 | 言い換えカバー +15pt |
| D | **Shadow mode** 実装 (ctx.waitUntil で candidate 並列実行) | Experiment Tracker | 2 日 | ユーザー影響ゼロで新 prompt 検証 |
| E | Golden Set を 200 件に拡張 + LLM-as-Judge 導入 | Model QA | 3 日 | CI gate 成立 |
| F | **3 段エスカレ UX** 実装 (部分回答 → 代替情報 → 人間) | UX Researcher | 2 日 | 「たらい回し」削減 |
| G | **faq_candidates Silver 層** (embedding cluster + 頻度閾値 ≥3) | Data Engineer | 3 日 | 採択率 3% → 40%+ |
| H | **Sentiment + dead-loop 検出** で escalation 理由コード拡張 | Support Responder + Feedback | 2 日 | 炎上予防 |

### Phase 3: 長期投資 (2-3 ヶ月)

| # | アクション | 備考 |
|---|-----------|------|
| α | **Hybrid retrieval + RRF** (BM25 + embeddings 融合) | Phase 2 完了後 |
| β | **KB バージョニング + R2 snapshot** + diff viewer | 更新頻度が上がったら |
| γ | **Drift detection cron** (semantic / staleness / contradiction) | Phase 2 完了後 |
| δ | **Model 比較** (Gemini Flash Lite vs Haiku 4.5) | shadow mode で 500 件 replay |
| ε | **CI/CD 統合** (PR 時 Golden Set 自動評価、閾値割れで merge block) | GitHub Actions |
| ζ | **identifier_hash HMAC** (widget identifier の改ざん防止) | 既出セキュリティ懸念 (16-sloten-site-integration.md) |

---

## 📊 KPI ダッシュボード (提案)

全員が挙げた指標を統合:

| カテゴリ | メトリクス | 現状 | Phase 1 目標 | Phase 2 目標 |
|---------|-----------|------|--------------|--------------|
| **Retrieval** | Hit@8 (Golden Set) | 不明 (~40-50%) | 測定開始 | 85%+ |
| **Grounding** | KB Citation Rate (n-gram ≥30%) | 不明 | 測定開始 | 70%+ |
| **Accuracy** | Keyword Inclusion Score | 不明 | 測定開始 | 90%+ |
| **Compliance** | NG ワード検知数/週 | 不明 | **0 件/週** | 0 件/週維持 |
| **UX** | Resolution Rate | 推定 81% | 測定開始 | 65%+ (逆に落ちて OK) |
| **UX** | Re-query Rate | 不明 | 測定開始 | <15% |
| **UX** | TTFMR | ~1.7s | <3s | <2s |
| **Operations** | feedback 入力率 (📈👎) | 0% | **20%+** | 40%+ |
| **Operations** | escalation rate (open/total) | 19% | 25-30% | 25-30% 帯維持 |
| **Experiment** | 月次実験数 | 0 | 1-2 本 | 2-4 本 |

---

## 🚦 実装前に判断が必要な項目 (ユーザー向け questions)

1. **コンプライアンス違反 NG ワード辞書** の具体リスト承認 (景表法専門家レビュー要？)
2. **依存症 RG 固定文言** の内容確認 + 相談窓口番号の最新化
3. **Phase 2 の Workers AI / Vectorize 導入** → Cloudflare 追加課金が発生する (想定 $5-15/月)
4. **Golden Set 200 件の作成主体** — AI で drafts → 運用者レビューか、完全人力か (時間 vs 品質)
5. **shadow mode の LLM コスト** 2-3 倍化の許容範囲 (現状 407 calls/月 → 800-1200 calls/月想定)
6. **顧客側 👍👎** の Phase 1 配置 NG を確定 (UX Research 推奨)

---

## 📁 個別レポート

- [01-ai-engineer-rag.md](01-ai-engineer-rag.md) — RAG 構造的ボトルネック + FTS5/Vectorize 実装案
- [02-model-qa-specialist.md](02-model-qa-specialist.md) — Golden Set + 自動評価メトリクス 4 つ
- [03-experiment-tracker.md](03-experiment-tracker.md) — A/B 致命的欠陥 + Shadow/Canary プロトコル
- [04-data-engineer.md](04-data-engineer.md) — chunking / embeddings / Silver 層 / drift detection
- [05-feedback-synthesizer.md](05-feedback-synthesizer.md) — Silent 失敗 TOP 5 + 👍👎 UI 設計 + 重大事故検知
- [06-ux-researcher.md](06-ux-researcher.md) — 日本人カジノ顧客期待値 + Tone/Length 最適解 + 3 段エスカレ
- [07-support-responder.md](07-support-responder.md) — AI 回答禁止 TOP 7 + 依存症/RG 対応 + 炎上防止

---

## 🎬 次に取るべきアクション

**Quick Wins (Phase 1) の 1-5 番** を最優先で実装することを推奨。工数 ~3 人日で測定基盤 + 法的安全装置が揃い、その後の改善サイクルが回せるようになる。

ユーザー承認があれば個別実装タスクとして進めます。
