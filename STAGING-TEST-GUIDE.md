# スロット天国 ステージング環境 テスト案内

> このドキュメントは、ステージング環境を社内/協力者にテスト依頼する際にそのまま共有できる形式です。
> 最終更新: 2026-05-05 / 環境バージョン: widget fix21 + AI v2 (Fix A+B+C 適用済)

---

## 🎯 テスト URL

### Widget（ユーザー視点・**ログイン不要**）
```
https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/
```

開いてすぐにチャットウィジェットが起動します。本番 (sloten.io) には影響しません。

### Admin パネル（運用視点・要ログイン）
```
URL:      https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/admin/
Email:    tester@staging.test
Password: 6jr3aYmKDPb3U5De
Role:     admin（FAQ / ナレッジ / メニュー / ボーナスコード / AI ログ等すべて閲覧・編集可）
```

⚠️ 本アカウントは**ステージング専用テスト用**です。本番環境には存在しません。テスト終了後にオーナーが無効化します。

---

## ✅ 動作確認済み機能（直近 100 ラン QA で検証済）

| カテゴリ | 例 | 期待動作 |
|---|---|---|
| 入金方法の質問 | 「PayPay入金方法」「銀行振込のやり方」「ATM入金手順」 | **5ステップの具体手順**を案内 |
| 出金の質問 | 「出金方法を教えて」「出金にどれくらい時間かかる」 | 反映時間と手順を明示 |
| アカウント | 「登録方法」「KYCは必要？」 | **KYC 原則不要**を明示 |
| ボーナス | 「ボーナスコードの使い方」「入金不要ボーナス」 | 適切に案内 |
| サイト情報 | 「ライセンス」「営業時間」 | ジョージア・24h |
| 機種スペック | 「継続率80%以上」「天井1300G」 | **機種データベースから具体機種名+数値**を返答 |
| 実行依頼 | 「入金したい」 | メニュー誘導 |
| オペレーター要請 | 「オペレーターと話したい」「担当者呼んで」 | **即エスカレーション** |
| 英語クエリ | 「How do I deposit?」 | 日本語のみ対応の旨を返答 |
| 苦情 | 「ふざけるな」「金返せ」 | エスカレーション |

---

## 🧪 推奨テストシナリオ

### シナリオ A: AI チャット基本フロー
1. Widget を開く
2. 「メニュー」ボタンを押してメインメニューを表示
3. 「💰 入金・出金」→「ご入金について」を選択
4. 「🏦 銀行振込」を選択
5. **AI 待機メッセージ**が表示される（GAS 未接続のため）
6. 「PayPay入金方法を教えて」など自由入力
7. AI が具体手順で返答することを確認

### シナリオ B: 機種データベース検索
1. Widget を開いてメニュー無視
2. 「スマスロで継続率80%以上の機種を教えて」と入力
3. AI が pachi-slot-crawler データから複数機種を提示することを確認
4. 「天井1300Gくらいの機種」など別パターンも試す

### シナリオ C: ボーナスコード申請
1. メニュー「💰 ボーナスコード申請」を選択
2. 表示されたコード一覧から任意のものを選択（例: バモスイボナ）
3. 受付完了メッセージを確認
4. ※GAS 連携は未設定のため、スプレッドシート記録は走らない

### シナリオ D: ドリームポット
1. Widget 上部の **金縁の Dreampot バナー** をクリック
2. `https://sloten.io/lottery` が新規タブで開く
3. 表示金額がリアルタイムで更新されている（jackpot SWR キャッシュ）

### シナリオ E: エスカレーション
1. AI 待機状態で「ふざけるな」「金返せ」「オペレーターと話したい」など投入
2. **即時に担当者おつなぎメッセージ**が出ることを確認
3. 会話のステータスが open に変わる

### シナリオ F: 多言語拒否
1. 「How do I deposit money?」と英語で入力
2. 「申し訳ございませんが、現在は日本語のみの対応となっております」と返ることを確認

---

## ⚠️ 既知の制約・未接続項目

| 項目 | 状態 |
|---|---|
| BANK_TRANSFER_BOT_WEBHOOK_URL | **未設定** — 銀行振込クリック時、webhook 失敗 → AI 待機モードに移行（仕様通り） |
| GAS_BOT_WEBHOOK_URL (PayPay) | **未設定** — PayPay 入金クリック時も同様に AI 待機 |
| EC_DEPOSIT_BOT_WEBHOOK_URL | **未設定** — コンビニ入金 |
| BONUS_CODE_WEBHOOK_URL | **未設定** — ボーナスコード申請は受付完了メッセージのみ表示、スプレッドシート記録は走らない |
| 本番 sloten.io との連携 | なし — ステージング独立 |
| Chatwoot 連携 | なし — sloten-standalone は自前 widget |
| 絵文字スタイル | OS 依存（Windows: Segoe UI Emoji / iOS: Apple Color Emoji） — 同じ機能でも見た目が異なる |

---

## 🐛 バグ報告フォーマット

下記をテンプレとして報告してください:

```
【概要】（1 行）

【再現手順】
1.
2.
3.

【期待動作】

【実際の動作】

【スクショ/動画】

【環境】
- ブラウザ: Chrome / Safari / Firefox
- OS: Windows / Mac / iOS / Android
- 日時: YYYY-MM-DD HH:MM (JST)

【その他】
（widget version は画面右上「対応中・fix21」で確認可能）
```

---

## 📊 主要変更点（直近）

| 日付 | 内容 |
|---|---|
| 2026-05-05 | Fix A+B+C 適用 — AI 空応答対策（catch fallback / finish_reason 計測 / 自動 retry） |
| 2026-05-05 | system prompt 強化 — KYC 「原則不要」明示、英語拒否、deflection 禁止 |
| 2026-05-04 | FTS5 trigram tokenizer 化 — 日本語自然文クエリの FAQ ヒット率改善 |
| 2026-05-04 | escalation.mjs 拡張 — 「オペレーター/担当者と話したい」を hard escalation に |
| 2026-05-04 | 銀行振込/PayPay/ATM の **即時 handoff を AI 待機に変更** |
| 2026-05-03 | Widget UI fix21 — Welcome card / Dreampot CTA / メニュー chevron 修正 |
| 2026-05-02 | pachi-slot-crawler 統合 — 機種スペック質問に対応 |
| 2026-05-02 | Bonus code v10.0 パリティ — sheet_name / game_selection 追加 |

---

## 🔗 参考

- Widget version 表示位置: ヘッダー右下「対応中・fix21」
- Worker Version ID: `c60d73a4-4029-4996-8a6f-1b9423fafa4c`
- D1 DB: `sloten_standalone_db_staging_bk`

---

質問・追加テスト依頼はオーナー (rcc.aoki@gmail.com) までお願いします。
