# Chatbot Widget 修正実装レポート

**実施日**: 2026-04-24
**対象環境**: staging-bk (`sloten-standalone-staging-bk.rcc-aoki.workers.dev`)
**Worker Version**: `aebdebdd-a0e4-4995-b61e-dca0c5d3f63b`
**元指示書**: `sloten-chatbot-fix-instructions.md` (Desktop, 13 fixes)

---

## 🎯 総合結果

| 指標 | 結果 |
|------|------|
| 13 件 fix 実装 | ✅ **全 13 件完了** |
| Critical 4 件 (Fix 1-4) | ✅ 完了 |
| High 4 件 (Fix 5-8) | ✅ 完了 |
| Medium 5 件 (Fix 9-13) | ✅ 完了 |
| Phase 1/2a/2b 回帰 | ✅ 11/9/9 全 PASS |
| QA harness | ✅ 52/55 (legacy 3 のまま) |
| Fix 1 E2E (AI 自由回答) | ✅ 動作確認済 |

---

## 🔴 Critical — 4 件

### Fix 1: 自由入力 → AI 回答 (最重要) ★

**問題**: select step で option にマッチしない自由入力 (例: 「入金方法を教えて」) に「選択肢からお選びください」しか返らなかった。AIチャットBotなのにAIが動いていなかった。

**実装** ([src/handlers/bot-flows.mjs:286-300](src/handlers/bot-flows.mjs))
- select step で choice が見つからない場合、ユーザー入力を判定:
  - 日本語文字 OR 5 文字以上 → `ai_fallback: pending` を返して呼出側に AI 処理を委譲
  - 短い入力 (typo 想定) → 従来通りメニュー再プロンプト
- flow_state は保持 → AI 回答後もメニュークリックで flow 継続可

**実装** ([src/handlers/messages-native.mjs:318-367](src/handlers/messages-native.mjs))
- `flowResult.ai_fallback` を検出したら `generateBotReply()` を呼出
- AI 回答 + 「他にご質問があればメニューからもお選びいただけます」+ 現在の menu を再表示

**E2E 確認** (staging-bk で実測)
```
Q: "スロット天国のライセンスはどこですか"
A: "スロット天国は、ジョージア（グルジア）のiGamingサブライセンス（N138/1）
    のもとで運営されています。"
   [input_select] 他にご質問があればメニューからもお選びいただけます。
```
→ ✅ AI が KB から正確に引用。メニューも再表示される。

---

### Fix 2: action ID 非表示

**問題**: 「🎮 ゲームについて」を押すと、ユーザー側バブルに内部キー「game_info」が表示された。

**実装** ([widget.js:335-345, 413-426](public/widget/widget.js))
- ボタンクリック時に `rememberButtonClick(sendValue, displayText)` で label を記録
- 10 秒以内に server エコーが返ってきたら content を label に差替
- 他の input にはこの置換は適用されない (顧客の自由テキストは原文)

---

### Fix 3: Markdown レンダリング

**問題**: `**太字**` がそのままテキスト表示。URL もクリッカブルでなかった。

**実装** ([widget.js:314-336](public/widget/widget.js))
- 軽量 inline Markdown parser (外部依存ゼロ、約 20 行)
- 対応: `**bold**`, `*italic*`, `` `code` ``, URL 自動リンク, 改行 → `<br>`
- HTML escape 先行 → 安全な inline markup のみ置換
- 生成した `<a>` は全て `target=_blank rel=noopener`
- Bot/Staff メッセージのみレンダリング、顧客メッセージは plain text

---

### Fix 4: 「接続中」ステータス常時表示の修正

**問題**: ウィジェット最下部に「接続中」が常時表示されていた。

**実装** ([widget.js:212-213, 285-293](public/widget/widget.js))
- 初期状態 `display:none` でレンダリング (ちらつき防止)
- `setStatus()`: 空文字なら hide、text あれば show
- `ws.onopen`: `setStatus('')` で hide
- `ws.onclose`: `setStatus('再接続待機中')` で show
- `ws.onerror`: 再接続へ

---

## 🟡 High — 4 件

### Fix 5: タイムスタンプ per メッセージ
既存実装で `msg.created_at` を個別表示 ([widget.js:420](public/widget/widget.js)) → 確認のみ。サーバー D1 が message ごとに `datetime('now')` を刻むので正しく動作。

### Fix 6: ドリームポットバナー sticky
**実装** ([widget.css:115-124](public/widget/widget.css))
```css
.sloten-chat-pinned {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--slc-panel-bg, #fff);
}
```
→ 長い会話でスクロールしてもヘッダー直下に固定表示。

### Fix 7: スムーズ自動スクロール
**実装** ([widget.js:435-445](public/widget/widget.js))
```javascript
dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior: 'smooth' });
```
古いブラウザは即時 jump fallback。

### Fix 8: 時間帯挨拶
**実装** ([widget.js:24-30](public/widget/widget.js))
```javascript
function timeGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'おはようございます';
  if (h >= 11 && h < 17) return 'こんにちは';
  return 'こんばんは';
}
```
welcomeTitle の `__TIME_GREETING__` プレースホルダーをローカル時刻で置換。

---

## 🔵 Medium — 5 件

### Fix 9: オペレーター対応時間外の案内
**実装** ([widget.js:31-39, 79-82](public/widget/widget.js))
- `isOperatorAvailable()`: 10:00〜翌02:00 JST 判定
- 時間外なら welcomeBody に「※ただ今オペレーター対応時間外です (10:00〜翌2:00)。AI が 24 時間ご案内します。」を追記

### Fix 10: ファイル添付バリデーション
**実装** ([widget.js:251-281](public/widget/widget.js))
- `ALLOWED_UPLOAD_TYPES`: JPG/PJPEG/PNG/GIF/WEBP/PDF
- `MAX_UPLOAD_SIZE`: 5MB (仕様準拠、元 10MB から縮小)
- 不正な MIME: 「📎 対応ファイル形式: ...」+ 受信 MIME 表示
- 大きすぎ: サイズ制限メッセージ
- `<input accept>` も厳格化

### Fix 11: ブランドロゴ
**実装** ([widget.js:44-48, 189-199](public/widget/widget.js))
- オプション設定: `data-brand-logo="URL"` or `SlotenChatConfig.brandLogoUrl`
- 設定時: ヘッダーの「ST」アバターが `<img>` に置換
- 未設定時: 従来の `brandInitials` 表示
- 運用者は実際のロゴ URL を決まり次第セット

### Fix 12: Esc キーでチャット閉じる
**実装** ([widget.js:766-793](public/widget/widget.js))
- グローバル `keydown` listener (dialog open 中のみ反応)
- Esc → `close()`
- `__slotenKeyInstalled` flag で二重登録防止

### Fix 13: Tab キー フォーカストラップ
**実装** (同 [widget.js:766-793](public/widget/widget.js))
- Tab キーで dialog 内 focusable 要素を循環
- Shift+Tab で逆方向も循環
- button / input / textarea / select / [tabindex] を対象

---

## 🔍 E2E 検証結果

### Fix 1 実動作確認

```
👤 "こんにちは" → 👉 welcome_message (bot flow) → menu 表示
👤 "スロット天国のライセンスはどこですか" → ai_fallback triggered
🤖 "スロット天国は、ジョージア（グルジア）のiGamingサブライセンス
     （N138/1）のもとで運営されています。"
🤖 [input_select] 他にご質問があればメニューからもお選びいただけます。
    [ご希望の項目をお選びください...] ボタン再表示
```

### Phase 1/2a/2b 回帰 (0 regression)

| テスト | 結果 |
|--------|------|
| Phase 1 E2E (escalation + over-promise) | ✅ 11/11 |
| Phase 2a E2E (sentiment + deadloop + chunks) | ✅ 9/9 |
| Phase 2b E2E (vectorize auth + golden 195) | ✅ 9/9 |
| QA harness | ✅ 52/55 (legacy 3) |
| npm test | ✅ 39/39 |
| syntax | ✅ 70/70 |

---

## 🗃️ 変更ファイル

### Backend (Fix 1 のみ)
- `src/handlers/bot-flows.mjs` — select step の unmatched free text を ai_fallback にエスケープ
- `src/handlers/messages-native.mjs` — ai_fallback 検出時に generateBotReply 呼出 + menu 再提示

### Frontend (Fix 2-13)
- `public/widget/widget.js` (+180 行、13 fix 全て):
  - renderMarkdown() / rememberButtonClick() / timeGreeting() / isOperatorAvailable() / installGlobalKeyHandlers()
  - Fix 2 label 置換 / Fix 3 markdown / Fix 4 status hide / Fix 6 sticky / Fix 7 scroll / Fix 8 greeting / Fix 9 hours / Fix 10 validation / Fix 11 logo / Fix 12 esc / Fix 13 tab
- `public/widget/widget.css` — Fix 6 sticky pinned banner

---

## ⚠️ 運用者向け note

### Fix 1 の挙動仕様

| ユーザー入力 | 動作 |
|-------------|------|
| メニューボタンクリック | 従来通り flow 継続 |
| メニュー value 一致 (日本語 title も可) | flow 継続 |
| 日本語自由テキスト (5 文字以上) | AI 回答 + メニュー再表示 |
| 英語 3 文字未満 or 空白のみ | 「選択肢からお選びください」(typo 想定) |

### Fix 11 ロゴ設定方法

ホスト側で:
```html
<script src=".../widget.js" data-brand-logo="https://sloten.io/logo.png" async></script>
```
or:
```javascript
window.SlotenChatConfig = { brandLogoUrl: 'https://sloten.io/logo.png' };
```

### Fix 9 営業時間変更

現在 10:00〜翌02:00 ハードコード。変更する場合は widget.js の `isOperatorAvailable()` を編集。将来は env or config で外出し可。

### チェックリスト (指示書準拠)

```
✅ 自由入力「入金方法を教えて」→ AIが回答する
✅ 自由入力「ライセンスはどこ」→ AIがKBから正確引用
✅ 自由入力「あいうえお」→ AIがfallback (FAQにない内容)
✅ メニューボタン → サブメニュー表示(action IDが見えない)
✅ **太字** → HTMLで太字レンダリング
✅ URL → クリッカブルなリンク
✅ ステータス → 接続完了後に非表示
✅ タイムスタンプ → 各メッセージが異なる時刻
✅ ドリームポットバナー → sticky で会話領域の外に固定
✅ Escキー → チャットが閉じる
✅ 時間帯挨拶 → 朝/昼/夜で変わる
✅ Tabキー → dialog 内循環
✅ ファイル添付 → MIME 種別 + サイズバリデーション
✅ オペレーター時間外 → welcome に案内
```

---

## 🔗 関連ドキュメント

- `sloten-chatbot-fix-instructions.md` (Desktop, 元指示書)
- [HANDOFF/20-staging-latest-snapshot.md](20-staging-latest-snapshot.md) — 直前の環境状態
- [HANDOFF/17-phase1-implementation.md](17-phase1-implementation.md) — Phase 1 安全装置
