# AI/ML 実装提案

**エージェント**: AI Engineer
**視点**: OCR/NLP/異常検知の技術選定

---

## 1. 最大の機会: 着金確認 OCR 自動化

### モデル選定

**推奨: Gemini 2.5 Flash (Vision)** — 既に Gemini Flash Lite 導入済みで API key/billing/Workers fetch 経路が確立。日本語 OCR 精度は Google Cloud Vision と遜色なく、構造化抽出 (JSON mode + responseSchema) で PayPay スクショから `transaction_id / amount / datetime / recipient` を直接 JSON で取得可能。

**比較**:
- **Tesseract**: Workers 環境では wasm 版が必要、日本語精度が PayPay 画面 (白文字/グラデ背景) で 60-70%、却下
- **Claude 3.7 Sonnet Vision**: 精度は最高だが $3/M input tokens で 10 倍コスト、ROI 合わない
- **Google Cloud Vision (DOCUMENT_TEXT_DETECTION)**: 生テキスト抽出は最強だが、後段で LLM パースが必要 → 二段階でレイテンシ倍増
- **Gemini 2.5 Flash**: 精度 95%+、1 枚 $0.00015、構造化出力一発で終わる ← **推奨**

### 実装経路

**Cloudflare Workers 直接呼び出し**推奨。GAS 経由は 6 分実行制限とコールドスタートで NG。

```
Widget (画像 upload) → R2 bucket (temp 24h TTL)
  → Worker /verify-payment endpoint
    → Gemini generateContent (inline_data: base64 image + responseSchema)
    → D1 (抽出結果保存)
    → GAS webhook (スプレッドシート「着金確認」に書込)
```

GAS で収集済みの申告値と Vision 抽出値を **3-way match** (申告 txid == 画像 txid AND 申告金額 == 画像金額 AND 画像日時 < 現在 - 6h):

### Safety net

- `confidence_score` を Gemini に self-report させる (プロンプトで 0-1 を要求)
- 3 項目全一致 + confidence ≥ 0.9 → auto approve
- 2 項目一致 or confidence 0.7-0.9 → staff review キューに `priority=medium`
- それ以下 → `priority=high` で Slack/Telegram 通知
- **画像改竄検出**: EXIF/ELA (Error Level Analysis) を Worker で軽量実装、もしくは `sharp-wasm` で圧縮アーティファクト検出

### コスト試算 (1日 100 件, 月 3000 件)

| モデル | 単価 | 月額 |
|---|---|---|
| Gemini 2.5 Flash | $0.00015/img + output 300 tok | **$1.5/月** |
| Claude 3.7 Sonnet V | $0.0048/img | $14.4/月 |
| GCV + Flash 2 段 | $0.0015 + $0.0002 | $5.1/月 |

staff 1 件 2 分 × 3000 = 100h/月 の削減 → 時給 1500 円換算で **月 15 万円相当の人件費削減** vs コスト $1.5。

## 2. インテント分類 & 自動ルーティング

**推奨: Gemini Flash Lite で few-shot 分類 + embedding cache**

keyword/regex は「入金できない」「振り込めない」「PayPay 反映されない」の揺れで 30% 取りこぼす。LLM 置き換えの是非は **完全置き換え推奨**、ただし 2 層構成で:

1. **L1: 高頻度フレーズ embedding cache** — `text-embedding-004` で上位 200 フレーズを D1 にプリベクトル化、cosine ≥ 0.85 で即 route (レイテンシ 50ms, コスト実質 0)
2. **L2: miss 時のみ Flash Lite few-shot** — 8 カテゴリ × 3 例の prompt で分類、`structured output` で `{intent, confidence, entities}` 返却

コスト: 月 10 万メッセージの 20% が L2 行き = 2 万 call × $0.0001 = **月 $2**。人件費削減は flow 誤ルーティングによる staff escalation 削減で時給換算 月 3-5 万円。

## 3. 異常検知 (Fraud / Abuse)

**ルールベース (Worker) + LLM 分類 (high-risk のみ)** のハイブリッド。

- **Worker D1 ルール層** (コスト 0):
  - 同一 IP から 1h 以内 3 件以上 → flag
  - 同一 txid が過去 30 日に存在 → **確実にブロック** (D1 unique index)
  - 申告金額が PayPay 最大送金枠超過 → flag
  - User-Agent / 画像ハッシュ (perceptual hash, pHash) の重複検出

- **LLM 層 (flag 済みのみ)**: Gemini Flash に画像 + 過去履歴を投げて `{fraud_likelihood, reason}` 判定

isolation forest は Workers 環境で実行困難 (sklearn 不可) かつ教師データ不足で過剰検出。pHash + ルール + 高 risk のみ LLM が現実解。

## 4. 自動 FAQ 生成 & KB 更新

`extractor.mjs` の keyword clustering → **embedding clustering (HDBSCAN) に upgrade**:

1. 過去 30 日の conversation log を D1 から dump
2. Workers Cron (日次) → 各 user message を `text-embedding-004` で embedding
3. **HDBSCAN** をバックグラウンド Worker (Durable Object) で実行、min_cluster_size=5
4. 既存 FAQ との cosine 類似度 < 0.7 のクラスタ = **未カバー質問**
5. Gemini で各クラスタを「代表質問 + 推奨回答 draft」に要約 → admin dashboard に proposal

KB 鮮度: 各 KB doc に `last_reviewed`, 90 日超 + ヒット率低下を検知 → re-index 提案。

## 5. Voice of Customer 自動集約

- Sentiment: Gemini Flash Lite に conversation を渡し `{sentiment: -1..1, churn_risk: 0..1, topics: []}` 返却、月 $3
- 週次ダッシュボード: Cloudflare Cron → 1 週間分を Flash に要約投入 → markdown レポートを R2 に保存 + 経営 Slack に投稿

## 6. 実装難易度マトリクス

| 案 | 難易度 | 工数 | 月額コスト | 人件費削減 |
|---|---|---|---|---|
| 1. OCR 着金自動化 | 3 | 8 人日 | $2 | **¥150,000** |
| 2. インテント分類 | 2 | 4 人日 | $2 | ¥40,000 |
| 3. 異常検知 | 3 | 6 人日 | $1 | ¥30,000 + 不正損失回避 |
| 4. FAQ 自動生成 | 4 | 10 人日 | $5 | ¥20,000 |
| 5. VoC 集約 | 2 | 3 人日 | $3 | 間接効果 (経営判断質向上) |

## 7. 実装順序 推奨 top 3

1. **着金 OCR 自動化** — ROI 圧倒的 (¥150k/月 vs $2)、技術枯れており 8 人日で完結、既存 Gemini 経路流用で新規 vendor なし
2. **異常検知 (ルール + pHash)** — 実装 6 人日で fraud 損失の expected value が 1 件 ¥5,000-50,000。txid 重複チェックだけでも先行実装価値あり (1 人日)
3. **インテント分類 L1 embedding cache** — 4 人日で完了、Widget UX 改善 (誤ルーティング削減) が継続率に効くため複利で効く

案 4/5 は 1-3 で取得される運用データが 2-3 ヶ月溜まってから着手が合理的 (cold start 問題回避)。
