# AI エージェント用 ステージング QA プロンプト

> 別の AI エージェント（Claude Code、ChatGPT、Cursor 等）にコピペして渡すための完全自走型テストプロンプトです。
> このまま貼り付ければ、エージェントが自動的に環境を理解し、全機能をテストし、構造化レポートを返します。

---

## 推奨エージェント

- **Claude Code** (Sonnet/Opus) + Playwright MCP — 視覚検証含む包括的テスト
- **ChatGPT** (o3 or 4.1) + ブラウザツール — 対話的探索
- **Cursor agent / Cline** — ローカル Playwright 実行可

---

## プロンプト本体（このセクションをコピペ）

```
あなたは「スロット天国」ステージング環境の徹底的 QA を行う AI QA エンジニアです。
現状の実装が正しく動くか、特に AI 対応 (Gemini Flash Lite + pachi-RAG + FAQ + KB) が
意図通りに振る舞うかを、Playwright で実機テストして検証してください。

# システム概要

- **アーキテクチャ**: Cloudflare Workers (sloten-standalone-staging-bk) + D1 + KV + DurableObject
- **AI**: Gemini 2.5 Flash Lite (provider=gemini) + pachi-slot-crawler RAG (機種データ) + FTS5 trigram FAQ/KB retrieval
- **フロー**: bot_flows テーブルの sloten-main (id=18) — welcome → 8 メニュー → サブメニュー → webhook/handoff
- **重要な設計**: 銀行振込/PayPay/ATM の webhook 失敗時は **AI 待機モード** に入る (handoff 即起動はしない)

# テスト対象 URL

- Widget (顧客視点・ログイン不要):
  https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/

- Admin パネル (運用視点・要ログイン):
  URL:      https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/admin/
  Email:    tester@staging.test
  Password: 6jr3aYmKDPb3U5De

- Widget API (直接テスト用):
  POST /api/widget/contacts            → contact + token 作成
  POST /api/widget/conversations       → conversation 作成 (X-Sloten-Contact-Token)
  POST /api/widget/conversations/{id}/messages   → メッセージ送信、bot_replies で受信

# 利用可能なツール

優先順位:
1. Playwright (実機ブラウザ操作 + 視覚確認)
2. Widget API への直接 fetch (バックエンド検証・高速イテレーション)
3. Admin パネル (FAQ/メニュー/ボーナスコード CRUD 検証)

# テスト戦略

## カテゴリ A: AI 応答正確性 (各カテゴリ最低 2-3 ケース)

A1. **入金方法の情報質問**: 「PayPay入金方法」「銀行振込のやり方」「ATM入金手順」
    期待: 5ステップの具体手順、「上部メニューからお選びください」のみは禁止

A2. **出金の情報質問**: 「出金方法」「出金にどれくらい時間かかる」
    期待: 出金手順、反映時間の言及

A3. **アカウント情報**: 「KYCは必要？」「登録方法は？」
    期待: KYC = 「原則不要」を明示。「必要となる場合があります」は誤答

A4. **ボーナス情報**: 「ボーナスコードの使い方」「入金不要ボーナスは？」
    期待: 適切な手順案内

A5. **サイト基本情報**: 「ライセンスはどこ？」「営業時間は？」
    期待: ジョージア iGaming N138/1、24時間対応

A6. **機種スペック (pachi RAG)**:
    - 「スマスロで継続率80%以上の機種」→ pachi DB から具体機種一覧
    - 「天井1300Gくらいの機種」「天井が800Gの機種」→ filter_failed なら
       「絞り込めませんでした」と素直に返答 (FAQ 259 の NOLIMITCITY 文言を絶対に混入しない)
    - 「面白いスマスロ」→ tags=["スマスロ"] 抽出され機種一覧
    - 「バイオハザードヴィレッジについて」→ name_keywords でマッチ

## カテゴリ B: フロー遷移の正確性

B1. **welcome → 8 メニュー → サブメニュー**: 各メニューを順次クリックして正しいサブメニューが表示されるか

B2. **コンビニ入金の多段フロー** (重要):
    deposit_methods → 🏪 コンビニ入金 →
    Step1: アカウントID 入力プロンプト (例: syt2525m)
    Step2: 金額選択 (¥3,000/¥5,000/¥10,000/¥20,000/¥50,000/再入力)
    Step3: handoff message に {{vars.account_id}} と {{vars.amount}} が補間されているか

B3. **銀行振込/PayPay/ATM の AI 待機モード**:
    deposit_methods → 銀行振込クリック →
    - "ただいま自動案内を準備しています。AIがご質問を承ります。"
    - "ご質問がございましたらメッセージをご入力ください。AIがご対応いたします。"
    の 2 メッセージが表示
    - 直後に「PayPay入金方法は？」と聞いて AI が具体手順を返すか
    - 直後に「オペレーター」と入力 → 即エスカレーションするか

## カテゴリ C: エスカレーション

C1. **明示的請求**: 「オペレーターと話したい」「担当者を呼んで」「人間と話したい」
    期待: hard-escalation 発火 → 「担当者よりご対応させていただきます」+ 会話 status='open'

C2. **苦情・怒り**: 「ふざけるな」「金返せ」「詐欺だ」
    期待: ANGER_PATTERNS マッチ → エスカレーション

C3. **RG (Responsible Gambling)**: 「もうやめたい」「依存気味」「借金まみれ」
    期待: RG_PATTERNS マッチ → 専用メッセージでエスカレーション

C4. **金銭トラブル**: 「入金されない」「出金が遅い」「アカウント凍結」
    期待: HARD_ESCALATION で deposit_issue/withdrawal_issue/account_freeze 等の reason

## カテゴリ D: ボーナスコード申請

D1. メニュー → ボーナスコード申請 → コード一覧表示
    各コード（バモスイボナ、トライアスロン等）を入力 → 受付メッセージが返るか
    - 「バモスイボナ」入力 → vamos_bonus_success メッセージ
    - 「ホワイトデー」入力 → white_day_success メッセージ
    - 「GWフェスティバル」入力 → gw_festival_success メッセージ (v9.7)
    - 「マルチハント」「バカラ道場」「体験パスポート」(v9.5/9.6) も同様

D2. **動的コード追加**: Admin で新規ボーナスコード作成 → widget でコード入力 → 受付確認

## カテゴリ E: 多言語・不明入力

E1. 英語 「How do I deposit money?」→ 「日本語のみの対応」
E2. 中国語 「如何存款？」→ 同上
E3. 意味不明 「foobar123xyzqq」→ 「ご質問内容を確認できませんでした」
E4. 短文 「うん」「はい」→ 適切な確認返答

## カテゴリ F: Widget UI / UX

F1. **古いボタンの stale 化** (Bug 4 修正検証):
    welcome メニュー → 入金・出金 サブメニュー表示時、welcome メニューの 8 ボタンが
    薄い・グレースケール・クリック不可 (pointer-events:none) になっているか
    → スクショで視覚確認

F2. **fix21 デザイン**: ヘッダー、Welcome カード、Dreampot バナー、メニューグリッド、
    各要素のサイズ・色・配置が `STAGING-TEST-GUIDE.md` の参照デザインと一致するか
    → スクショ撮影

F3. **Dreampot リアルタイム更新**: 1 分ごとに金額が更新されるか (`/api/public/jackpot` の SWR)

F4. **添付ファイル**: PDF/画像を添付して送信できるか (要 R2 バインディング動作)

## カテゴリ G: Admin パネル

G1. **FAQ CRUD**: 新規 FAQ 追加 → widget で関連質問 → 新 FAQ がヒットするか
G2. **メニュー編集**: bot_menus の編集 → widget で反映確認
G3. **ボーナスコード v10.0**: 動的コード追加で sheet_name + game_selection が保存されるか
G4. **AI 回答ログ**: 直近の応答が retrieval_trace 付きで表示されるか
   特に finish_reason / block_reason / retried フィールドの値

## カテゴリ H: パフォーマンス・堅牢性

H1. **レイテンシ測定**: 各カテゴリの平均応答時間 (期待: AI 応答 8-15s、メニュー <1s、jackpot <500ms)
H2. **Empty response 0 件**: 同じ質問を 5 回繰り返して空応答が出ないか
H3. **同時接続**: 5 conversation 並列で送信して全て応答返るか
H4. **Stale state リカバリ**: 銀行振込→AI 待機後に他メニューをクリック → 正しい sub-menu 起動 (Bug 2/3 修正)

# テスト実施方法

各カテゴリで以下を実施:
1. **fresh contact + conversation を毎回作成** (前テストの汚染を防止)
2. メッセージ送信 → bot_replies を取得
3. 期待動作と一致するか判定
4. 不一致なら、retrieval_trace を D1 から取得して原因分析

# 出力形式 (必須)

最終レポートに以下を含めてください:

## サマリ
- 全カテゴリの PASS/FAIL 数
- CRITICAL バグ (即修正必須) の件数
- WARN (改善推奨) の件数

## 詳細結果 (カテゴリ別)
| ID | テスト | 結果 | 応答内容 (抜粋) | 問題点 |
|----|--------|------|----------------|--------|
| A1.1 | paypay入金方法 | ✅ PASS | "PayPay（マネー...) 5ステップ手順" | - |
| A6.2 | 天井800G | ❌ FAIL | "NOLIMITCITY..." | FAQ 259 が混入 |
| ... | ... | ... | ... | ... |

## CRITICAL/WARN/INFO 別の修正提案
各バグについて:
- 再現手順
- 期待動作 vs 実際の動作
- 推定根本原因 (コード/DB/プロンプト)
- 推奨修正案

## 視覚スクショ (Bug 4 / fix21 デザイン検証)
保存先: C:\\tmp\\qa-screenshots\\
代表的なスクショは添付してレポート

# 制約

- **書き込み禁止**: D1 の bot_flows / faq / knowledge_sources は read-only
  (Admin で新規追加した FAQ は最後に必ず削除して環境を元に戻す)
- **デプロイ禁止**: コード修正・wrangler deploy は行わない
- **シークレット閲覧禁止**: AI_GATEWAY_SHARED_SECRET / GEMINI_API_KEY は不要
- **時間予算**: 1〜2 時間以内で完了
- **並行性**: rate-limit 回避のため、単一 widget 内では 1.5 秒間隔

# 成功基準

- 全カテゴリの 90% 以上が PASS
- CRITICAL は 0 件
- WARN は 5 件以下
- 視覚検証: fix21 デザインが参照スクショと一致

# 補足: 既知バグ (再発がないか確認)

直近修正済み (再発したら CRITICAL):
- Bug: 「天井800G」で NOLIMITCITY 混入 → filter_failed バイパスで修正
- Bug: 「PayPay入金方法」が「上部メニューからお選びください」で deflection → 旧 ai_prompts deactivate で修正
- Bug: 銀行振込→AI 待機後、ボーナス・プロモが AI ハルシネーション → flow_state クリーンアップで修正
- Bug: コンビニ入金がアカウント ID 入力後に止まる → 3 ステップフローで修正
- Bug: 古いメニューボタンがクリック可能 → data-stale=1 で修正

これらが再発していないことを最初に確認してください。
```

---

## 補足情報（プロンプト外で渡せるもの）

### Widget API クイックリファレンス

```javascript
// 1. Create contact
const c = await fetch('https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/api/widget/contacts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tenant_id: 'tenant_default' })
}).then(r => r.json());
// → { contact: {id, ...}, contact_token }

// 2. Create conversation
const conv = await fetch('https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/api/widget/conversations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Sloten-Contact-Token': c.contact_token,
  },
  body: JSON.stringify({ contact_id: c.contact.id, tenant_id: 'tenant_default' })
}).then(r => r.json());

// 3. Send message + receive bot_replies
const reply = await fetch(`https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/api/widget/conversations/${conv.conversation.id}/messages`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Sloten-Contact-Token': c.contact_token,
  },
  body: JSON.stringify({ sender_type: 'customer', content: 'PayPay入金方法' })
}).then(r => r.json());
// → { success, message, bot_reply, bot_replies: [...] }
```

### Playwright クイックスタート

```javascript
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/');
await page.evaluate(() => document.querySelector('.sloten-chat-root')?.setAttribute('data-open', '1'));
await page.click('.sloten-chat-menu-btn');
await page.waitForSelector('.sloten-chat-grid-item');
```

### 期待される回答パターン (PASS 基準)

| 質問 | 期待要素 | 禁止要素 |
|---|---|---|
| paypay入金方法 | 「手順」「PayPay」「①〜⑤ or 1.〜5.」 | 「ボタンを押」「上部メニューから」のみ |
| KYCは必要？ | 「原則不要」「電話番号とメールアドレス」 | 「必要となる場合があります」 |
| 天井800G | 「絞り込めませんでした」 | 「NOLIMITCITY」「BUY」 |
| How do I deposit? | 「日本語のみ」 | 入金手順を英語で答える |
| オペレーターと話したい | 「担当者よりご対応」 | 「メニューから選んで」 |
