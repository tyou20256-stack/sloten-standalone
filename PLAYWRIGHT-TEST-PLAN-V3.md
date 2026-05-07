# Playwright Test Plan v3 — sloten-standalone-staging-bk

> v2 結果の反省を反映: 25/12/2 → 25/13/0 へ。本物のコードバグ vs テストハーネスバグを分離する。
> 対象 Worker: `62d39380-8ca4-4a03-bef2-0509e551a8e7` 以降
> 直近の修正:
> - Group A: 空応答 fallback ([messages-native.mjs:374-405](src/handlers/messages-native.mjs#L374-L405))
> - 出金 jump 抑止: announcements ヒント検知 ([menu-tree.mjs:162](src/lib/menu-tree.mjs#L162))
> - 英語検知 short-circuit ([ai-chat-adapter.mjs:325-340](src/ai-chat-adapter.mjs#L325-L340))
> - ライセンス FAQ INSERT (D1 staging-bk)

---

## 0. v2 ハーネスの致命的バグと v3 修正

### バグ 1: `getLastRealBotMsg` が過剰除外
v2 では「ご質問やお困りごと」を含むメッセージを**全除外**したが、これがメニュー遷移後の正常 bot 応答に偶然含まれていた場合 (例: 「お困りごとがございましたら…」の本体FAQ) も除外され、空文字を返した。

**v3 修正**: 完全一致のみ除外。サーバー由来のメッセージは `data-msg-id` が `greet-` で始まらないので、その判定で除外可能:

```javascript
async function getBotMessagesAfterUser() {
  return await page.evaluate(() => {
    const all = [...document.querySelectorAll('.sloten-chat-msg')];
    // Find the last user message
    let lastUserIdx = -1;
    all.forEach((el, i) => { if (el.dataset.sender === 'user') lastUserIdx = i; });
    // Return all bot messages AFTER that user message, excluding client greeting
    return all.slice(lastUserIdx + 1)
      .filter(el => el.dataset.sender === 'bot')
      .filter(el => !(el.dataset.msgId || '').startsWith('greet-'))
      .map(el => el.textContent.trim());
  });
}
```

### バグ 2: テストが「LAST bot msg」しか読まない
実際の挙動は `[AI応答, メニュー再表示]` の 2 メッセージ。v2 は LAST = メニュー を読んで FAIL 判定。

**v3 修正**: 上記関数で取得した**全 bot メッセージを結合**して期待語句を含むか判定:

```javascript
async function assertResponseContains(expected, options = {}) {
  const timeout = options.timeout || 15000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const msgs = await getBotMessagesAfterUser();
    const combined = msgs.join('\n---\n');
    if (combined.includes(expected)) return { pass: true, combined };
    await page.waitForTimeout(500);
  }
  return { pass: false, combined: (await getBotMessagesAfterUser()).join('\n---\n') };
}
```

### バグ 3: T4-1 セッション残存
ログイン済み Cookie が前のテストから持ち越され `input[name=email]` が非表示。

**v3 修正**: テストブロック先頭で `await context.clearCookies()` 強制リセット。

---

## 1. 必須セットアップ (新セッション初期化)

```
mcp__playwright__browser_navigate https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/
mcp__playwright__browser_resize 1280 900
browser_evaluate `
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
  window.__pwErrors = [];
  window.addEventListener('error', e => window.__pwErrors.push({type:'error', msg:e.message}));
  window.addEventListener('unhandledrejection', e => window.__pwErrors.push({type:'rejection', reason:String(e.reason)}));
`
```

各テスト先頭で必ず:
```
browser_evaluate `if (window.SlotenChat) SlotenChat.reset()`
browser_navigate <same widget url>  // forced reload
browser_wait_for selector:.sloten-chat-launcher
browser_click .sloten-chat-launcher
browser_wait_for selector:.sloten-chat-input
```

---

## 2. v3 テストケース (38 → 32 に整理)

### T1 ウィジェット視覚 (8) — v2 と同じ、追加変更なし

### T2 メニュー分岐 (5)
| ID | 入力 | 期待 (assertResponseContains) |
|---|---|---|
| T2-1 | 銀行振込クリック | "ご質問やお困りごと" or "AI" or 入力欄が enabled |
| T2-2 | PayPay クリック | 同上 |
| T2-3 | コンビニATM クリック | 同上 |
| T2-5 | ボーナスコード→任意選択 | "受付" or "完了" or "ありがとう" |
| T2-7 | 「メニュー」入力 | grid items 8 個 |

> **T2-4/T2-6 削除** — 仕様上ライセンス・出金は自由入力でアクセスする (T3-C1 / T3-C5 でカバー)

### T3 AI 応答 (16)

#### T3-A: お知らせ (3)
| ID | 入力 | 期待 |
|---|---|---|
| T3-A1 | 最新のお知らせを教えて | 「お知らせ」 or 日付 (2026/) or 「申し訳ございません」(fallback) |
| T3-A2 | GW期間中の入出金について | "GW" or "ゴールデンウィーク" or "連休" — **withdrawal_methods へ jump しないこと** |
| T3-A3 | PayPay入金メンテナンス予定 | 「メンテナンス」関連語句 or fallback |

#### T3-B: 機種 RAG (3)
| ID | 入力 | 期待 |
|---|---|---|
| T3-B1 | スマスロで継続率80%以上の機種 | 機種名 + % or 「絞り込めません」(filter_failed bypass) |
| T3-B3 | バイオハザードヴィレッジについて | 機種仕様 or 「絞り込めません」or 機種名含む |
| T3-B4 | 天井1300Gの機種ある | 機種名 or 「絞り込めません」 |

#### T3-C: FAQ (5)
| ID | 入力 | 期待 |
|---|---|---|
| T3-C1 | 出金にはどれくらい時間がかかりますか | 「30分」or「営業日」or「目安」 |
| T3-C2 | PayPay入金方法 | 5ステップ手順 or PayPay 関連語句 |
| T3-C3 | KYCは必要？ | 「KYC」+「不要」 |
| T3-C4 | 登録方法を教えて | 手順 |
| T3-C5 | ライセンスを教えて (NEW) | 「ジョージア」 |

#### T3-D: エスカレーション・英語 (4)
| ID | 入力 | 期待 |
|---|---|---|
| T3-D1 | オペレーターと話したい | 「担当者」or「お繋ぎ」 |
| T3-D2 | ふざけるな | 「申し訳」or 担当者 |
| T3-D3 | 金返せ | 担当者 |
| T3-D4 | How do I deposit money? | 「日本語のみ」 |

#### T3-E: 耐性 (1)
| ID | 入力 | 期待 |
|---|---|---|
| T3-E1 | 同じ質問 5 回連投 | 全てに何らかの bot 応答 |

### T4 管理画面 (3)
- T4-1: ログイン (Cookie clear 必須)
- T4-2: 会話一覧 (5s wait + 行 OR "No conversations" メッセージで PASS)
- T4-4: FAQ 管理画面表示

### T7 ネットワーク
- console errors: `/api/staff/me` 401 は既知 (admin 未ログイン状態) として **無視**
- 4xx/5xx: `/api/staff/me` 以外があれば FAIL

---

## 3. wrangler tail デバッグ手順 (T3-A1/B3 が依然 FAIL の場合)

### 3.1 別ターミナルで tail を起動 (テスト開始前)

```powershell
cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
npx wrangler tail --config wrangler.staging-bk.toml --format pretty | Tee-Object -FilePath C:\tmp\tail-T3A1.log
```

### 3.2 Playwright で T3-A1 を 1 件だけ実行

`browser_navigate widget` → reset → 「最新のお知らせを教えて」送信 → 15秒待機 → ログ採取

### 3.3 ログから確認すべき行

| 出ているか? | ログパターン | 意味 |
|---|---|---|
| ✓ | `[announcements] query detected` | detectAnnouncementQuery が true を返した |
| ✗ | (出ない) | パターン不一致 → ai-chat-adapter まで届いていない |
| ✓ | `[announcements] fetch error: ...` | sloten.io API への fetch 失敗 |
| ✓ | `tokensIn=N tokensOut=M finishReason=...` | Gemini のレスポンス状況 |
| ✓ | `finishReason=SAFETY` or `OTHER` or `MAX_TOKENS` | safety block / 異常停止 |
| ✓ | `[bot-flow] ai_fallback called` | フロー側ルート確認 |

### 3.4 想定される問題と対応

| 観察 | 推定原因 | 対応 |
|---|---|---|
| `[announcements] query detected` 不出 | パターン不一致 | announcements.mjs ANNOUNCEMENT_QUERY_PATTERNS 拡張 |
| `fetch error` | sloten.io 障害 / タイムアウト | timeout 4s→8s, または cache fallback |
| `finishReason=SAFETY` | Gemini が「お知らせ」を sensitive 判定 | safety setting 緩和 |
| Gemini OK だが output 短い | system prompt が「メニュー誘導に徹してください」を強く解釈 | announcements ブロック内に「announcements 内容を本文に明記すること」追記 |
| そもそも ai_fallback 呼ばれない | bot-flow が別経路 | bot-flows.mjs のログ追加 |

### 3.5 T3-B3 (バイオハザードヴィレッジ) の場合

```
✓ [pachi-rag] machine query detected (conf=...)
✓ [pachi-rag] context injected: N machines  ← N が 0 なら DB に該当機種なし
```

N=0 なら pachi-api 側へクエリして DB の正規化文字列を確認:
```powershell
curl -H "Authorization: Bearer $env:PSC_API_KEY" `
  "https://pachi-api.bkpay.app/api/v1/machines?q=バイオハザード"
```

スペース区切りや「スマスロ」プレフィックスで保存されている場合は prefix/suffix probe を強化。

---

## 4. v3 期待される改善点

| ID | v2 | v3 期待 | 根拠 |
|---|---|---|---|
| T3-A2 | FAIL | PASS | jump 抑止追加済 |
| T3-D4 | FAIL | PASS | 英語 short-circuit 追加済 |
| T3-C5 | (NEW) | PASS | ライセンス FAQ 追加済 |
| T3-A1/B3 | FAIL | 改善 (full bot 結合読み) or wrangler tail で原因確定 |
| T2-1〜5 | FAIL | PASS (回復) | greeting filter 厳格化 |
| T4-1 | FAIL | PASS | clearCookies |

---

## 5. 出力フォーマット

`C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT-v3.md`:
```markdown
# v3 Report — Worker 62d39380...
## サマリ: A PASS / B FAIL / C SKIP

## v2→v3 比較 (差分のみ)
| ID | v2 | v3 | 判定 |
| T3-A2 | FAIL | PASS | 修正効果確認 |
| ... 

## 残存バグ (再現性ありのみ)
... 

## wrangler tail 観察結果 (T3-A1/B3)
... 

## v3 ハーネス自体の問題 (もし発見されたら)
...
```
