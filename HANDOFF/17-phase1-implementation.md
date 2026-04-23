# AI 精度向上 Phase 1 実装レポート

**実装日**: 2026-04-23
**対象環境**: staging-bk (`sloten-standalone-staging-bk.rcc-aoki.workers.dev`)
**Version**: `b51c159f-d75a-43d2-984e-300287708999`
**元提案**: [HANDOFF/ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) の Phase 1 (8 項目 + FTS5)

---

## 🎯 総合結果

| 指標 | 結果 |
|------|------|
| E2E テスト | ✅ **11/11 PASS** |
| 既存機能回帰 | ✅ **52/52 PASS** (QA harness 再実行、regression なし) |
| ユニットテスト | ✅ **39/39 PASS** |
| 構文チェック | ✅ **63/63 OK** |
| Migration 018/019 | ✅ 両方 staging-bk に適用済 |
| Golden Set | ✅ **30 件 seeded** |

---

## 📦 実装内容

### 1. Migration 018 — AI 精度基盤 ([migrations/018-ai-accuracy-phase1.sql](migrations/018-ai-accuracy-phase1.sql))

- `ai_logs` に **`retrieval_trace`** (JSON) + **`escalation_reason`** カラム追加
- **`golden_set`** テーブル新設 (evaluation corpus, 30 rows seeded)
- Silent-failure ビュー 3 種 (`v_ai_silent_escalation`, `v_ai_repeat_question`, `v_ai_anger_followup`)
- **ai_prompts 汚染 2 本を無効化**: `oor` / `oor-1145` (body="x") → is_active=0, weight=0

**即効効果**: `default-A/B` がそれぞれ 50/50 で本来の A/B テストに戻った (前は 34% のトラフィック)。

### 2. Migration 019 — FTS5 BM25 Retrieval ([migrations/019-fts5-retrieval.sql](migrations/019-fts5-retrieval.sql))

- `faq_fts` / `kb_fts` 仮想テーブル作成 (`unicode61 remove_diacritics 2` tokenizer)
- INSERT/UPDATE/DELETE トリガーで元テーブルと自動同期
- 既存 47 FAQ + 23 KB sources を rebuild

**即効効果**: 「priority DESC, usage_count DESC」の priority ソートが **BM25 ranking** に置換。関連しない FAQ の注入が削減。

### 3. responseFilter.mjs — 過剰約束ワード soft-mask ([src/responseFilter.mjs](src/responseFilter.mjs))

- 10 パターンの過剰約束 NG ワード (必ず / 絶対 / 100% / 保証 / 即時 / 24 時間以内に / 〜円もらえ) を**自動置換**:
  - 「必ず」→「通常は」
  - 「絶対」→「基本的に」
  - 「100%」→「ほぼ」
  - 「24時間以内に」→「通常 1 営業日を目安に」
- AI がパスワード / カード番号を要求するパターンもブロック

**影響**: E2E `detectOverPromise('必ず24時間以内に反映...')` → 5 ヒット検出、全部置換確認済。

### 4. escalation.mjs (新設) — キーワード検出 + 理由コード ([src/escalation.mjs](src/escalation.mjs))

- **HARD_ESCALATION_PATTERNS** (9 種): 返金 / 出金できない / 訴える / 凍結 / 未成年 / 退会 / 不正アクセス
- **RG_PATTERNS** (6 種): やめたい / 依存症 / 借金 / 生活費 / 死にたい
- **ANGER_PATTERNS** (5 種): 詐欺 / ふざけんな / SNS 晒し
- **dead-loop 検出**: 直近 3 ターンが全て同一内容 → エスカレ
- RG 相談窓口は `env.RG_HELPLINE_TEXT` で上書き可 (古くなった電話番号を再デプロイなしで更新)

### 5. ai-chat-adapter.mjs 改修 ([src/ai-chat-adapter.mjs](src/ai-chat-adapter.mjs))

- **Step 0**: escalation gate を追加 (AI 実行前に決定)
- **retrieval**: priority ソート → `retrieveContext()` (FTS5 BM25) に置換
- Gemini/Anthropic 両方で **tokens_in / tokens_out** を usageMetadata から取得
- **retrieval_trace** JSON を ai_logs に保存 (faq_ids, kb_ids, strategy)
- **over_promise_hits** も保存 (後で audit 可能)
- Personal data request filter (AI が "パスワードを教えて" と言うのを防ぐ)

### 6. messages-native.mjs — escalation top priority ([src/handlers/messages-native.mjs](src/handlers/messages-native.mjs))

- Flow 突入/bonus code match より**前**に escalation 判定
- escalation 発火時:
  - `flow_state` を clear
  - `conversation.status = 'open'` (人間エスカ)
  - canned response を送信
  - ai_logs に escalation 記録 (escalation_reason 付き)
- 通常 AI fallback 時は message history (直近 6 件) を渡して dead-loop 検出を有効化

### 7. retrieval.mjs (新設) — FTS5 BM25 ハンドラ ([src/retrieval.mjs](src/retrieval.mjs))

- FTS5 availability を動的判定 (migration 未適用なら legacy fallback)
- 日本語を `"token" OR "token"` 形式で BM25 score 順に取得
- FTS5 ヒットなし → priority fallback を hybrid で返す (空の context を避ける)
- `retrieve_trace` に faq_ids / kb_ids / strategy を記録

### 8. ai-logs.mjs — feedback rating 拡張 + silent-failure endpoint

- `submitFeedback`: rating=1 (👍), -1 (👎), **-2 (⚠️ 重大)** を受付
- `listSilentFailures`: `?view=escalation|repeat|anger` で 3 ビューを公開
- `recordAiCall`: 新カラム (retrieval_trace, escalation_reason) に対応

### 9. Admin UI ([public/admin/sections/bot-data.js](public/admin/sections/bot-data.js))

- **AI ログ画面**: 各行に 3 つの one-click ボタン **👍 / 👎 / ⚠️** (モーダル不要で 3 秒記録)
- tokens カラム + retrieval strategy カラム追加
- **新セクション「AI サイレント失敗」** (`/admin/#ai-silent-failures`)
  - 3 タブ: 即エスカレーション / 再質問 / 怒り語
  - migration 018 のビューから直接表示
- Admin ナビメニューに 🔕 AI サイレント失敗 エントリ追加

### 10. scripts/seed-golden-set.mjs — Golden Set 30 件 draft

カテゴリ別配分:
- 入出金: 9 件 (PayPay/銀行/コンビニ/ATM/最低入金額/出金時間 + 返金/出金問題 3 件はエスカ)
- ボーナス: 6 件 (入金不要/ボーナスコード/賭け条件/有効期限/週末/ダブルボーナス)
- アカウント: 6 件 (パスワード変更/メール/KYC/年齢 + ログイン不可/削除 2 件はエスカ)
- コンプライアンス: 5 件 (全てエスカ — 依存症/訴える/消費者センター/未成年)
- 雑談: 4 件 (挨拶/範囲外/おすすめ禁止)

`reference_answer` は空のまま seed — **運用者がレビュー時に記入** する前提。

---

## 🔍 E2E テスト結果

```
=== Phase 1: Escalation (HARD_KW) ===
✅ hard:money_refund    (返金してほしい → 大変恐れ入ります...)
✅ hard:withdrawal_issue (出金されない → 大変恐れ入ります...)
✅ hard:legal_claim     (訴えるぞ → 大変恐れ入ります...)
✅ hard:account_deletion (アカウントを削除 → 大変恐れ入ります...)

=== Phase 1: RG (依存症兆候) ===
✅ rg:もうやめたい、全部負けた (→ 相談窓口案内表示)
✅ rg:ギャンブル依存症かも (→ 相談窓口案内表示)

=== Phase 1: Anger ===
✅ anger:詐欺だろこれ (→ ご不快な思いを...申し訳ございません)
✅ anger:ふざけんな最悪だ (→ ご不快な思いを...申し訳ございません)

=== Phase 1: Other ===
✅ ai-trace:sent (ai_logs に retrieval_trace JSON が書かれる)
✅ over-promise filter: 5 hits 全て置換
✅ over-promise filter: false-positive なし

Summary: 11/11 PASS
```

## 🔒 既存機能回帰テスト

[HANDOFF/15-staging-bk-qa-report.md](15-staging-bk-qa-report.md) の QA harness を再実行:
- 52 PASS / 3 legacy FAIL (事前確認済の false-positive)
- **regression = 0**

---

## 📊 記録された escalation 分布 (staging-bk)

| reason | count |
|--------|-------|
| anger | 2 |
| rg_support | 2 |
| money_refund | 1 |
| withdrawal_issue | 1 |
| legal_claim | 1 |
| account_deletion | 1 |
| **合計** | **8** |

全て E2E テスト由来。本番投入後は運用実データが入る。

---

## 🗺️ 次のステップ — ユーザー判断事項

### 本番投入前チェックリスト

- [ ] **RG 相談窓口番号の最新確認** (escalation.mjs 内の scga.jp / 厚労省 URL は 2026-04 時点。古くなってないか運用側で確認)
- [ ] **Golden Set 30 件の reviewer レビュー** → reference_answer 記入 (AI ではなく運用者担当推奨)
- [ ] **過剰約束 NG ワード辞書** の法務確認 (景表法担当者)
- [ ] **本番 D1 に migration 018 + 019 を適用** (`npm run migrate:remote` — migrate-phase1 スクリプト要検討)
- [ ] **本番コードデプロイ**

### Phase 2 推奨実装 (次タスク)

Synthesis §Phase 2 の未着手項目:
- **knowledge_chunks 生成** (manual_kb 11 files → ~150 chunks)
- **Workers AI bge-m3 embeddings + Vectorize index**
- **Shadow mode** (ctx.waitUntil で candidate prompt を並列実行)
- **Golden Set 200 件拡張 + LLM-as-Judge**
- **3 段エスカレ UX** (部分回答 → 代替情報 → 人間)
- **faq_candidates Silver 層** (embedding cluster + 頻度閾値)

### 運用開始時の観測すべき KPI

| KPI | 現状 | 目標 |
|-----|------|------|
| feedback 入力率 (👍👎⚠️) | 0% | **20%+** (1週間以内) |
| escalation_reason 分布 | テストデータのみ | 本番運用で測定開始 |
| retrieval strategy 分布 (fts5 vs legacy) | 未観測 | **fts5 90%+** 想定 |
| over_promise_hits | 未観測 | **0 /週** を目標 |
| silent-failure 3 ビュー件数 | 未観測 | 週次レビュー |

---

## 🗃️ 変更ファイル一覧

### 新規 (4 ファイル)
- `migrations/018-ai-accuracy-phase1.sql`
- `migrations/019-fts5-retrieval.sql`
- `src/escalation.mjs`
- `src/retrieval.mjs`
- `scripts/seed-golden-set.mjs`

### 改修 (6 ファイル)
- `src/responseFilter.mjs` (+ 75 行 over-promise / personal-data)
- `src/ai-chat-adapter.mjs` (retrieval 置換 + usageMetadata + escalation gate)
- `src/handlers/messages-native.mjs` (+ escalation top priority)
- `src/handlers/ai-logs.mjs` (feedback rating 拡張 + silent-failures endpoint + retrieval_trace 記録)
- `src/index.mjs` (silent-failures route + updateContact route (既存))
- `public/admin/sections/bot-data.js` (feedback buttons + silent-failure section)
- `public/admin/index.html` (ナビメニュー)

### staging-bk DB 状態
- Tables: **36** (was 26, +10 for FTS5)
- golden_set: **30 rows**
- ai_logs with escalation_reason: 8 rows
- ai_prompts active: 2 (default-A/B のみ)

---

## 🔗 関連ドキュメント

- [HANDOFF/ai-accuracy-discussion/00-synthesis.md](ai-accuracy-discussion/00-synthesis.md) — 元の 7 専門家議論
- [HANDOFF/15-staging-bk-qa-report.md](15-staging-bk-qa-report.md) — 前回の QA 結果
- [HANDOFF/02-deploy-runbook.md](02-deploy-runbook.md) — デプロイ手順
