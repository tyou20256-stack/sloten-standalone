# Playwright MCP テスト計画 — sloten-standalone-staging-bk

> 目的: 別セッションで Playwright MCP を起動した Claude Code が、このファイルを読み込むだけで網羅検証を実行できる状態にする。
> 最終更新: 2026-05-06 / 対象: widget fix21 + AI v2 (announcements RAG / filter_failed bypass / バイオハザード prefix-suffix probe)

---

## 0. 起動手順 (新セッションでの初期化)

```
1. mcp__playwright__browser_navigate → https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/
2. mcp__playwright__browser_resize → 1280x900 (デスクトップ想定)
3. mcp__playwright__browser_console_messages を毎ステップ確認 (赤エラーは即記録)
4. テスト中に発生したスクショは .overnight-state/screenshots/ ではなく C:\tmp\sloten-pw-YYYYMMDD-HHMM\ に保存
```

### ネイティブダイアログ無効化 (必須)

ページロード直後に `browser_evaluate` で:
```javascript
window.alert = () => {};
window.confirm = () => true;
window.prompt = () => '';
window.__pwErrors = [];
window.addEventListener('error', e => window.__pwErrors.push({type:'error', msg:e.message, src:e.filename, line:e.lineno}));
window.addEventListener('unhandledrejection', e => window.__pwErrors.push({type:'rejection', reason:String(e.reason)}));
```

---

## 1. テスト対象 URL

| 用途 | URL | 認証 |
|---|---|---|
| ウィジェット (デモ) | https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/ | 不要 |
| 管理画面 | https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/admin/ | tester@staging.test / 6jr3aYmKDPb3U5De |
| お知らせ API (確認用) | https://sloten.io/api/public/announcements | 不要 |

---

## 2. 主要 DOM セレクタ (widget.js より抽出)

| 要素 | セレクタ |
|---|---|
| ランチャー (FAB) | `.sloten-chat-launcher` |
| パネル | `.sloten-chat-panel` |
| 閉じる | `.sloten-chat-close` |
| Welcome カード | `.sloten-chat-welcome` |
| メニューボタン (Welcome 内) | `.sloten-chat-menu-btn` |
| Dreampot CTA | `.sloten-chat-dreampot-cta` |
| Dreampot コイン SVG | `.sloten-chat-dreampot-coin svg` |
| Dreampot 金額 | `#slc-dreampot-amount` |
| メッセージスクロール | `.sloten-chat-scroll` |
| メッセージ吹き出し | `.sloten-chat-msg[data-sender="bot"\|"user"]` |
| メニュー選択肢 (グリッド項目) | `.sloten-chat-grid-item` |
| stale (古い) ボタン群 | `.sloten-chat-msg-grid[data-stale="1"]` |
| 入力 | `.sloten-chat-input` |
| 送信 | `.sloten-chat-send` |
| 添付 | `.sloten-chat-attach` |
| 入力中インジケーター | `.sloten-chat-typing` |
| ステータス | `.sloten-chat-status` |
| 副題 (バージョン表示) | `.sloten-chat-subtitle` (末尾 `· fix21`) |

---

## 3. ウィジェット UI 視覚チェック (T1)

| ID | チェック項目 | 期待 | 失敗条件 |
|---|---|---|---|
| T1-1 | ランチャー FAB 表示 | 右下に円形ボタン | 表示なし / クリック不可 |
| T1-2 | パネル展開 | クリックで panel が visible | 開かない / コンソールエラー |
| T1-3 | ヘッダー副題 | 末尾 `· fix21` | 別バージョン文字列 |
| T1-4 | Welcome タイトル | 👋 アイコン + cfg.welcomeTitle | アイコン欠損 |
| T1-5 | Dreampot コイン SVG | 80px、グラデーション + 王冠あり | NaN attribute / sizing 崩れ |
| T1-6 | Dreampot 金額 | `¥` + 数字 (¥… ではなく実値) | `¥…` のまま (jackpot fetch 失敗) |
| T1-7 | Dreampot CTA pill | テキスト + 角丸 pill 形状 | 矩形ボタン / テキスト切れ |
| T1-8 | チェブロン | メニュー項目に `›` | `>` 表示 / 欠損 |

**T1 検証コマンド例:**
```
mcp__playwright__browser_snapshot  → role=button[name=ランチャー] 等の存在
mcp__playwright__browser_take_screenshot fullPage:true → C:\tmp\sloten-pw-XXX\T1-baseline.png
browser_evaluate `document.querySelector('.sloten-chat-subtitle').textContent` → 末尾 fix21 確認
browser_evaluate `getComputedStyle(document.querySelector('.sloten-chat-dreampot-coin svg')).width` → 80px 近辺
browser_evaluate `document.querySelector('#slc-dreampot-amount').textContent` → /^¥[\d,]+$/
```

---

## 4. メニュー分岐 (T2)

すべて Welcome → メニューボタン → 各分岐を `browser_click` でたどる。

| ID | パス | 期待結果 |
|---|---|---|
| T2-1 | 💰 入金・出金 → ご入金について → 🏦 銀行振込 | "AI 待機中" 系メッセージ + 入力欄解放 |
| T2-2 | 💰 入金・出金 → ご入金について → 💳 PayPay | 同上 |
| T2-3 | 💰 入金・出金 → ご入金について → 🏪 コンビニ ATM | 同上、途中で止まらない |
| T2-4 | 💰 入金・出金 → ご出金について | 出金種別メニュー |
| T2-5 | 🎁 ボーナス・プロモ → ボーナスコード申請 | コード一覧表示 → 1つ選択 → 受付完了 |
| T2-6 | 質問・サポート → ライセンス | ジョージア記載の回答 |
| T2-7 | 入力欄に「メニュー」と直接入力 | キーワード→メニュー直接ジャンプ |

**T2 失敗時の必須記録:**
- `browser_snapshot` でその時点の DOM 構造
- `browser_console_messages` のエラー
- `browser_evaluate window.__pwErrors` 内容
- スクショ `T2-X-FAIL.png`

---

## 5. AI 応答テスト (T3) — 最重要

各テストは **新しい会話** で実施 (デモページの「localStorage の会話状態をリセット」ボタンを押してリロード)。

### T3-A: お知らせ RAG (NEW — 最新追加機能)

| ID | 入力 | 期待される語句 (含まれるべき) | NG (含まれてはいけない) |
|---|---|---|---|
| T3-A1 | `最新のお知らせを教えて` | 「お知らせ」+ 日付 (例: 2026/05/01発信 / 2026/04/29 等) | "お知らせはありません" |
| T3-A2 | `GW期間中の入出金について教えて` | 「ゴールデンウィーク」or「GW」or「連休」+ 反映遅延の旨 | 一般論のみで具体期間言及なし |
| T3-A3 | `PayPay入金メンテナンスはありますか？` | お知らせから関連項目を抜粋 (該当あれば) / なければ「現在予定なし」明示 | 嘘の予定を捏造 |
| T3-A4 | `お知らせ` 単独 | 一覧形式で複数件 | 「ご質問内容を…」等の deflection |

検証:
```
入力後 → browser_wait_for textContains:期待語句 timeout:10000
失敗時: browser_evaluate `document.querySelectorAll('.sloten-chat-msg[data-sender="bot"]').slice(-1)[0].textContent`
```

### T3-B: 機種データベース RAG (pachi)

| ID | 入力 | 期待 | NG |
|---|---|---|---|
| T3-B1 | `スマスロで継続率80%以上の機種を教えて` | 機種名 3件以上 + 継続率% 数値 | 「絞り込めませんでした」 |
| T3-B2 | `天井が800Gぐらいのスロットは？` | 800G付近の機種、NOLIMIT CITY を**メーカー扱いせず** | "NOLIMITCITY/パチンコ、パチスロ/バカラ" の混在文言 |
| T3-B3 | `バイオハザードヴィレッジについて教えて` | スマスロ バイオハザード ヴィレッジ の仕様 | 「該当機種なし」 (prefix/suffix probe 効くべき) |
| T3-B4 | `天井1300Gの機種ある？` | 1300G付近の機種 | 全件羅列 / 一般論 |

### T3-C: FAQ (出金・入金・KYC)

| ID | 入力 | 期待 | NG |
|---|---|---|---|
| T3-C1 | `出金にはどれくらい時間がかかりますか` | 銀行30分〜数時間/仮想通貨数分等の **方法別目安** | 一律一文 |
| T3-C2 | `PayPay入金方法` | 5ステップ程度の手順 | 「メニューからお選びください」のみ |
| T3-C3 | `KYCは必要？` | **KYC 原則不要** を明示 | 「必要です」 |
| T3-C4 | `登録方法を教えて` | 手順案内 | 一般論 |

### T3-D: エスカレーション・苦情・英語

| ID | 入力 | 期待 | NG |
|---|---|---|---|
| T3-D1 | `オペレーターと話したい` | 即時担当者おつなぎ系メッセージ | AI 回答継続 |
| T3-D2 | `ふざけるな` | エスカレーション | bot 説教 / 沈黙 |
| T3-D3 | `金返せ` | エスカレーション | AI 反論 |
| T3-D4 | `How do I deposit money?` | 「日本語のみ対応」 | 英語回答 / 沈黙 |

### T3-E: 空応答耐性 (Fix A/B/C 検証)

| ID | 入力 | 期待 | NG |
|---|---|---|---|
| T3-E1 | `あ` (1文字) | 何らかの返答 (再質問でも可) | 完全沈黙 / spinner 永続 |
| T3-E2 | 同じ質問を 5 回連続送信 | 全てに返答 | 一部空 |

---

## 6. 管理画面 (T4)

### T4-1 ログイン
```
browser_navigate https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/admin/
browser_fill name=email tester@staging.test
browser_fill name=password 6jr3aYmKDPb3U5De
browser_click submit
→ ダッシュボードに遷移すること
```

### T4-2 会話一覧
- T3 で発生した会話が一覧に表示されているか
- 直近メッセージ・ステータス・時刻が正しいか

### T4-3 会話詳細
- 任意の会話を開く
- AI 返答 / ユーザー入力 / システムメッセージが時系列で表示
- T3-D1 (オペレーター呼び出し) の会話が `open` ステータスになっているか

### T4-4 FAQ 管理
- `出金にはどれくらい時間がかかりますか` の FAQ が is_active=1 で存在
- 編集画面が開けて保存できる (実保存はしない、cancel)

### T4-5 AI ログ / メトリクス (実装されていれば)
- finish_reason / 空応答 retry の発生回数が見える

---

## 7. コンソールエラー / ネットワークエラー回収

各テスト終了時:
```
browser_evaluate `JSON.stringify(window.__pwErrors)` → 空配列であること
browser_console_messages → error level メッセージなし (warn は許容)
browser_network_requests → 4xx/5xx のレスポンスを抽出
```

**特に注意:**
- `widget.js` から coin SVG レンダリング時の NaN warning (過去に ASI バグあり)
- jackpot fetch の 4xx (sloten.io 側 503 含む)
- announcements fetch の timeout (4秒制限)

---

## 8. 回帰チェックリスト (Smoke)

最低限これだけは毎回確認:

- [ ] T1-2 パネル展開
- [ ] T1-5 コイン SVG 表示 (NaN なし)
- [ ] T2-1 銀行振込 → AI 待機
- [ ] T3-A1 お知らせ取得
- [ ] T3-B1 機種 RAG
- [ ] T3-C2 PayPay 入金方法 (5ステップ)
- [ ] T3-D1 オペレーター呼び出し
- [ ] T4-1 管理画面ログイン
- [ ] コンソールエラー 0 件

---

## 9. レポート出力

すべてのテスト終了後、`C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT.md` に以下を出力:

```markdown
# Playwright Test Report — sloten-standalone-staging-bk
日時: YYYY-MM-DD HH:MM
Worker Version ID: (browser_evaluate で /api/version を取得 or HTML metaから)

## 結果サマリ
- 合格: X / Y
- 失敗: A / Y
- スキップ: B / Y

## 失敗詳細
### TX-Y: タイトル
- 入力: ...
- 期待: ...
- 実際: ...
- スクショ: TX-Y-FAIL.png
- コンソールエラー: ...

## 推奨修正
1. ...
```

---

## 10. 既知の制約・許容事項

| 項目 | 状態 |
|---|---|
| BANK_TRANSFER_BOT_WEBHOOK_URL 未設定 | T2-1〜T2-3 で webhook 失敗 → AI 待機 (仕様通り、PASS) |
| jackpot 値が `¥…` のまま | sloten.io API 障害時許容 (T1-6 SKIP) |
| 絵文字レンダリング差 | OS 依存、視覚判定 PASS とする |
| お知らせ 0 件 | T3-A1 で「現在お知らせはありません」 → PASS (内容次第) |

---

## 11. 失敗時の優先度

| 重大度 | 例 | 対応 |
|---|---|---|
| CRITICAL | T1-2 パネル開かない / T3 全滅 / 管理画面ログイン不可 | 即フィードバック、デプロイロールバック検討 |
| HIGH | T3-A 全滅 / T3-D1 escalation 不能 | 修正 PR を作成 |
| MEDIUM | T3-B3 バイオハザード not found / 1件の T3-C | 原因調査、優先度付けて修正 |
| LOW | コイン SVG の色味差 / 微小な余白 | 朝レポートに記録のみ |
