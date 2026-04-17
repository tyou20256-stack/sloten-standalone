# GAS + テスト用スプレッドシート セットアップ手順

本番GASは触らず、**新規に** テスト用スプシ＋GASを作り、
`sloten-standalone` のステージング(staging-bk)から呼び出してE2Eテストします。

---

## 1. スプレッドシートを新規作成

1. https://sheets.new を開く
2. タイトル: `sloten-deposit-test`
3. 1行目(A1〜)に以下の見出しを入力:

```
timestamp | event | conversation_id | contact_id | contact_name | method | amount | name_or_id | screenshot_url | screenshot_filename | raw_payload
```

(コピーしてA1セルに貼り付け → タブ区切りで自動展開されます)

---

## 2. Apps Script を追加

1. スプシ上部メニュー: `拡張機能` → `Apps Script`
2. 開いたエディタで既存の `function myFunction()` を全消去
3. 以下を全コピペ:

```javascript
/**
 * sloten-standalone テスト用 GAS Webhook
 * スプレッドシートに入金テストを1行追加する。
 *
 * 有効化手順:
 *   1. 右上「デプロイ」→「新しいデプロイ」
 *   2. 種類の選択: ウェブアプリ
 *   3. 実行ユーザー: 自分
 *   4. アクセス権: 全員(匿名含む)
 *   5. デプロイ後のURLをコピーして Cloudflare secret に設定
 */

const SHEET_NAME = 'シート1'; // スプシのタブ名に合わせて変更可

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
      || SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // attachments は { screenshot_attachment_id: { url, filename, ... } }
    const att = payload.attachments && payload.attachments.screenshot_attachment_id;
    const screenshotUrl = att ? att.url : '';
    const screenshotFilename = att ? att.filename : '';

    sheet.appendRow([
      new Date(),                               // timestamp
      payload.event || '',                      // event
      payload.conversation_id || '',            // conversation_id
      (payload.contact && payload.contact.id) || '',
      (payload.contact && payload.contact.name) || '',
      payload.method || '',
      payload.amount || '',
      payload.name_or_id || '',
      screenshotUrl,                            // signed URL (24h有効)
      screenshotFilename,
      JSON.stringify(payload),                  // 原本ペイロード(デバッグ用)
    ]);

    // Worker側に返すJSON。message はボットメッセージとして顧客に表示される。
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        message: '✅ テストスプレッドシートに記録しました。',
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('sloten test GAS: alive');
}
```

4. 保存 (Ctrl+S)
5. 右上 **デプロイ** → **新しいデプロイ**
6. 歯車アイコン → **ウェブアプリ** を選択
7. 設定:
   - 説明: `sloten test v1`
   - 実行するユーザー: **自分**
   - アクセスできるユーザー: **全員** (重要: 匿名アクセス許可)
8. **デプロイ** ボタン → 初回はGoogleアカウント承認フロー(「詳細」→「安全ではないページへ移動」)
9. 完了後の **ウェブアプリURL** (`https://script.google.com/macros/s/XXXXX/exec`) を**コピー**

---

## 3. Cloudflare Worker 側にURLを設定

ローカルPCで:

```bash
cd C:/Users/PC/OneDrive/Desktop/sloten-standalone
npx wrangler secret put GAS_BOT_WEBHOOK_URL --config wrangler.staging-bk.toml
# プロンプトに、コピーしたGASのURLを貼り付けてEnter
```

---

## 4. テストフロー投入

```bash
node scripts/apply-deposit-test-flow.mjs
```

これで `deposit-test` フローが D1 に入り、`テスト入金` というトリガー語で発火します。

---

## 5. 実テスト

1. https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/ を開く
2. チャットボタンをクリック
3. 入力欄に **`テスト入金`** と送信
4. ボットの案内に沿って:
   - 入金方法を選択
   - 金額を入力 (例: `5000`)
   - 名義orアカウントIDを入力
   - **左下のクリップアイコン**から画像を添付
5. 提出後、「✅ テストスプレッドシートに記録しました。」と返答
6. スプレッドシートを確認 → 1行追加されているはず

スクショ列のURLをクリックするとR2に保存された画像が開きます(署名付き、24時間有効)。

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `テスト入金` と送っても何も起きない | フロー未投入 → 手順4を実行 |
| `システム連携でエラーが発生しました` | GAS URLが違う/デプロイのアクセス権が「自分のみ」→手順2.7を確認 |
| スプシに行が入らない | Apps Scriptエディタの「実行ログ」でエラー確認。`SHEET_NAME` 変数をタブ名に合わせる |
| 画像URLを開くと403 | 署名トークン期限切れ(24時間) / `PUBLIC_WORKER_URL` secret未設定 |

---

## 後片付け (本番移行後)

テストが完了したら:
1. `deposit-test` フローを無効化: `UPDATE bot_flows SET is_active = 0 WHERE name = 'deposit-test'`
2. `GAS_BOT_WEBHOOK_URL` を本番GAS URLに差し替え
