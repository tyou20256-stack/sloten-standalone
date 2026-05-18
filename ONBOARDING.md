# sloten-standalone — 引継ぎガイド (2026-05-18)

スロット天国（オンラインカジノ系商材）の AI カスタマーサポート。Chatwoot 非依存の自前チャットウィジェット + オペレーターUI。

- **スタック**: Cloudflare Workers + D1 + KV + R2 + Vectorize + Durable Objects + Workers AI
- **言語/対象**: 日本語のみ。エンドユーザーは入金/出金が反映されない系の問い合わせが大半
- **ステージング**: https://sloten-standalone-staging-bk.rcc-aoki.workers.dev
- **Repo**: `tyou20256-stack/sloten-standalone`（main）。直近コミット `5db4063`

## いま何が起きたか（直近セッションの成果 = 重要文脈）

「AI回答精度が低い」を解消した。**主因はモデルでも検索でもなく、有効DBプロンプト
(ai_prompts id=5) がハードコードの安全ルール（KYC原則不要/方法→手順引用 等）を
丸ごと上書きしていたこと**。Flash Lite がそれで正反対の幻覚を出していた。

対応（コミット `5db4063`、staging-bk デプロイ済 + migrations 032-035 適用済）:
- `buildSystemPrompt` が最優先ルール+基本情報を**常時前置**（DBプロンプトは追加層に降格）
- 主モデルを **Anthropic Haiku 4.5** に昇格（Gemini は逆フェイルオーバー）
- `kb_chunks_fts` を trigram 化、`retrieval.use_vectorize=1`、FAQ に dense+RRF 追加
- 内容ゼロのゴミFAQ 13件を無効化（active 52→39）

検証: KYC幻覚解消・方法質問は手順引用・provider=anthropic/strategy=hybrid_rrf。
Property/Integration 緑。Golden Set 実pipeline 59/67（残8は期待語句の文字列厳密性
or 正しいエスカレーションで**精度不良ではない**）。

## 最優先の残タスク（着手順）

1. **FAQ意味検索ベクトルの初回生成** — 未実行。`ADMIN_API_TOKEN`（wrangler secret）が必要。
   手順は `DEPLOY-RUNBOOK.md §6.5`（`POST /api/admin/vectorize/reindex {kind:"faq"}`）。
   未実行でも hybrid は kb_chunks ベクトル+FAQ trigram で稼働中（追加底上げ分が保留）。
2. **シークレットのローテーション** — 前任者とのチャットで Anthropic / Gemini API キーが
   平文共有された。本番移行前に必ずローテートすること。
3. 本番デプロイの真ブロッカー: `BANK_TRANSFER_BOT_WEBHOOK_URL` 未設定（BKチーム提供待ち）。

## 触る前に知るべき罠

- **AI精度を調べるときは最初に `SELECT id,is_active,system_prompt FROM ai_prompts WHERE is_active=1`**。
  有効DBプロンプトがハードコード安全プロンプトを上書きする設計（硬化済だが要警戒）。
- **`wrangler.staging-bk.toml` は gitignore**。`AI_PROVIDER=anthropic` 等はデプロイ済Workerに
  反映済みだが VCS に無い → 新規デプロイ時に再設定が要る。
- **会話の初回フリーテキストは正常に AI へ流れる**。フローは「AI回答→メニュー後置」が仕様。
  テストは `bot_replies` を**全結合**して判定すること（1メッセージだけ見ると誤判定する）。
- D1 インライン SQL は UTF-8 100KB 上限。`Buffer.byteLength(sql,'utf8')` で計測。
- Windows bash で日本語を curl `-d` インライン投入すると `?` 化する → `--data-binary @file`。

## 開発フロー

```bash
# テスト
npm run test:property && npm run test:integration

# マイグレーション（staging-bk）
WRANGLER_CONFIG=wrangler.staging-bk.toml D1_DB_NAME=sloten_standalone_db_staging_bk \
  node scripts/apply-migrations.mjs --remote

# デプロイ（staging-bk）
npx wrangler deploy --config wrangler.staging-bk.toml

# 実ログで精度確認
npx wrangler d1 execute sloten_standalone_db_staging_bk --remote \
  --command "SELECT input,output,provider,json_extract(retrieval_trace,'\$.strategy') FROM ai_logs ORDER BY id DESC LIMIT 20;"
```

- 本番手順の正は `DEPLOY-RUNBOOK.md`（§6.4 オペレーターボタン除去 / §6.5 Vectorize reindex は必須ステップ）
- アーキ詳細は `ARCHITECTURE.md`
- 主要コード: `src/ai-chat-adapter.mjs`(AI経路) / `src/retrieval.mjs`(RAG) / `src/handlers/messages-native.mjs`(フロー) / `src/handlers/bot-flows.mjs`
- 機種スペック RAG は pachi-slot-crawler（VPS 5.104.87.106、Tunnel経由）

## 方針メモ

sloten.io はオンラインカジノ系商材。AIチャット/KB/技術スタックの機能開発は対応可。
検知回避・違法性のあるマーケ最適化（CV最大化提案/クローキング設計等）には踏み込まない。
