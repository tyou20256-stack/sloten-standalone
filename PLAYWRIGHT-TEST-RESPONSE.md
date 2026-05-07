# Playwright 1st Run Response — 修正と再テスト指針

> 1st run: 25 PASS / 12 FAIL / 2 SKIP @ Worker `c60d73a4-...`
> 修正後デプロイ: Worker `d69152ca-f70a-4da7-b70f-f5fa2b8c6c4a`
> 日付: 2026-05-06

---

## ✅ Group A: 修正済み・要再テスト

### 根本原因
[messages-native.mjs:374](src/handlers/messages-native.mjs#L374) で `generateBotReply` が **例外を投げず空文字を返した場合**、AI メッセージ挿入が無音でスキップされ、後段のメニュー再表示のみがユーザーに見える状態だった。Fix A は throw のみ捕捉。

### 修正内容
[messages-native.mjs:374-405](src/handlers/messages-native.mjs#L374-L405) — `cleanText` 空時の `else` 分岐で polite fallback を挿入:

```text
申し訳ございません、ただいまうまくお答えできませんでした。
下のメニューから関連項目をお選びいただくか、別の言い方でお試しください。
```

### 影響範囲(再テストで PASS 期待)
- **T3-A1 最新のお知らせ** — 空応答時に fallback、announcements RAG が動けば本来の答え
- **T3-B3 バイオハザードヴィレッジ** — pachi RAG 失敗時も無音回避
- **T3-D4 英語** — Gemini が safety block しても fallback 表示
- **T3-C3 KYC** — Fix A の error メッセージは引き続き表示 (生きてる)

---

## 🔍 Group D: 個別バグ調査結果

### D-1: T2-4 出金メニュー → "Menu items: 0"
**結論: フロー仕様通り。テスト側のパス想定が誤り。**

DB 確認の結果、`bot_flows.sloten-main` には以下のステップが存在:
- `welcome_message` (start step) — 8 オプション
- `withdrawal_auto`, `withdrawal_not_received`, `withdrawal_cancelled` — 個別ステップ
- **`withdraw_menu` 親ステップは存在しない**

「💰 入金・出金」を押すと表示されるのは入金関連メニューのみ。出金は FAQ 経由 (`faq_processing_time` / `faq_payment_methods`) または自由入力で AI が拾う設計。

**修正候補 (オプション):**
1. 現状維持 + テストプラン修正 → 期待値を「FAQ 経由でアクセス」に変更
2. 「💰 入金・出金」を「💰 入金」と「💸 出金」に分離 → 大規模変更
3. 「💰 入金・出金」サブメニューに「ご入金について / ご出金について / 出金FAQ」を追加 → 中規模

→ **推奨: 1 (現状維持)**。出金は FAQ で網羅されている (T3-C1 PASS)。

---

### D-2: T2-6 ライセンス → 汎用応答
**結論: フロー内に「ライセンス」メニュー項目は存在しない。FAQ ナレッジベース経由で答えるべき項目。**

テストは「質問・サポート→ライセンス」を期待していたが、welcome_message には「質問・サポート」というオプションは無い (実際は「❓ よくある質問(FAQ)」)。

**修正不要** — 自由入力「ライセンス」「ライセンス情報」と入力すれば AI が FAQ から回答する。テストプランで再テスト経路を変更。

---

### D-3: T4-2 会話一覧 0 行
**結論: SPA 描画タイミング問題の可能性が高い。コード問題不明確。**

管理画面 (`/admin/`) は SPA で、ログイン後に conversations API を fetch する。Playwright 1st run でログイン直後にセレクタを読んだ可能性あり。

**確認事項:**
- ログイン → `wait_for` で会話行のセレクタを 5 秒待つ
- `/api/admin/conversations` の API 直接叩きで結果が返るか確認 (T7 の 401 と関連の可能性)

→ **テストプラン側で再現性確認が先**。サーバー側修正は再現後。

---

### D-4: T7 console 401
**結論: 管理画面の認証チェック前に走る API or WebSocket。要追跡。**

`Failed to load resource: the server responded with a status of 401 ()` だけで URL が不明。

**Group C テストプラン v2** で `browser_network_requests` のフィルタ `.url|contains("api/")` で 401 の具体 URL を取得することを必須化する。

---

## 🤔 Group B: KYC safety block

### 仮説
Gemini の safety filter が「KYC は必要？」を identity-related として block。`finishReason: SAFETY` or `OTHER` が返ると `aiReply.content` は空 → Fix A の throw 経路には行かず、Group A の新 fallback が発動する。

### 確認方法
本番ログで `finishReason` を観察:
```bash
npx wrangler tail --config wrangler.staging-bk.toml --format pretty | grep -E "finishReason|safetyRatings"
```
Group A デプロイ後に「KYCは必要？」を再テストし、ログで実際の finishReason を確認。

### 対策案 (確認後)
1. **system prompt 補強** — 「KYC関連質問には事務的に答え、機微情報は要求しない」を明記
2. **safety setting 緩和** — `HARM_CATEGORY_SEXUALLY_EXPLICIT` 等を `BLOCK_ONLY_HIGH` に
3. **deterministic short-circuit** — 「KYC」キーワード検知 → DB 直接 FAQ 引き当て (LLM バイパス)

→ **推奨: 3** (一番確実)。Group A デプロイ後に再テスト → SAFETY と確認できたら実装。

---

## 📝 Group C: テストハーネス v2 (再テスト用)

### 必須改善点

#### 1. 「こんにちは…」グリーティング除外
[widget.js:1049](public/widget/widget.js#L1049) はクライアント側の greet message。テストの「最後の bot メッセージ」取得時にこれを除外:

```javascript
const realBotMsgs = [...document.querySelectorAll('.sloten-chat-msg[data-sender="bot"]')]
  .filter(el => !el.textContent.includes('ご質問やお困りごと'));
const last = realBotMsgs[realBotMsgs.length - 1];
```

#### 2. AI 応答待機時間の延長
- Gemini レイテンシ: 3〜10 秒 + retry で 15 秒まで
- T3 系は `browser_wait_for` を timeout: **15000ms** に
- 「typing indicator が消えるまで」を待つ条件にする:
  ```javascript
  await page.waitForFunction(
    () => !document.querySelector('.sloten-chat-typing')?.offsetParent,
    { timeout: 15000 }
  );
  ```

#### 3. 各テストの完全リセット
リセットボタンクリック → `localStorage` 確認 → `reload()` → `wait_for` `.sloten-chat-launcher`

```javascript
await page.evaluate(() => SlotenChat.reset());
await page.reload();
await page.waitForSelector('.sloten-chat-launcher');
```

#### 4. 401 エラーの URL 特定
```javascript
const failed = await page.evaluate(() => 
  performance.getEntriesByType('resource')
    .filter(r => r.responseStatus === 401)
    .map(r => r.name)
);
```

#### 5. T2-4/T2-6 のテスト経路修正
- T2-4: 「出金時間」を自由入力 → FAQ 回答を期待 (T3-C1 と統合してもよい)
- T2-6: 「ライセンス」を自由入力 → AI 回答を期待

---

## 🎯 推奨再テスト順序

1. **Smoke (5min)**: T1-1〜T1-7, T2-1〜T2-3, T2-5, T2-7
2. **Group A 検証 (10min)**: T3-A1, T3-A2, T3-B3, T3-C3, T3-D4 — fallback メッセージが表示されるか
3. **Group B 観察 (5min)**: KYC 投入時に `wrangler tail` で `finishReason` キャプチャ
4. **Group D 確認 (10min)**: T2-4/T2-6 経路変更版、T4-2 wait 延長、T7 401 URL 取得
5. **完全テスト (30min)**: 全 39 ケース v2

---

## 🚀 次セッションへの引き継ぎ

```
次の Playwright MCP セッションで以下を実行:
1. C:\Users\PC\OneDrive\Desktop\sloten-standalone\PLAYWRIGHT-TEST-RESPONSE.md を読む
2. Group C のハーネス改善を適用
3. T3-A1, T3-A2, T3-B3, T3-C3, T3-D4 を最優先で再テスト
4. wrangler tail を別ターミナルで起動して finishReason をキャプチャ
5. 結果を C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT-v2.md に出力
```
