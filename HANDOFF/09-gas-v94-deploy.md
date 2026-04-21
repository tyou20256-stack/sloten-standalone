# 09. GAS v9.4 (Generic Handler) 適用手順

**目的**: 新ボーナスコード追加時の GAS コード編集を不要にする v9.4 を本番適用。

**ソースファイル**: `c:/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working/gas-bonus-code-v9.4.js`

**作業時間**: 30 分 (デプロイ 10 分 + テスト 20 分)

**ダウンタイム**: ゼロ (GAS は新デプロイしても旧デプロイ URL はしばらく生きる。sloten-standalone 側でも旧コードのまま動作可)

**ロールバック**: 容易 (Apps Script の「デプロイを管理」から旧 version にリダイレクト可能)

---

## 🎯 前提条件

- [ ] ブラウザで Google アカウント (スプレッドシート所有者 or 編集者権限) にログイン済み
- [ ] 現行 GAS Script に edit access がある
- [ ] `sloten-standalone` が既に本番デプロイ済み (overnight 作業の main merge 完了)

---

## ⚠️ v9.4 導入のリスクと対応

### リスク 1: 既存 event への影響

**想定**: ゼロ
**理由**: switch 文の `default:` だけを変更しており、既存の全 `case` は手つかず。
**確認**: 適用後に既存 event (例: `stepup`, `vamos`) を 1 つテストして従来通り対応シートに記録されることを確認。

### リスク 2: 未知の `bonusType` がシート名と一致してしまう

**想定**: 低い
**理由**: sloten-standalone 側で `bonus_codes.gas_type` は admin が明示的に設定するため、タイポで既存シート名と衝突する可能性は低い。
**緩和**: v9.4 は「シートが存在しない場合のみ BC_ボーナスコード に fallback」するので、予期しないシートに書き込むケースは発生しない (シートが無ければ従来どおり)。

### リスク 3: v9.4 のデプロイ URL が変わる

**想定**: 変わる (Apps Script の仕様)
**対応**:
- 古いデプロイの URL は残しておく (削除しない) → 既存 sloten-standalone はそのまま動く
- 動作確認後に sloten-standalone の `BONUS_CODE_WEBHOOK_URL` を v9.4 の新 URL に切替
- 1 週間様子見して問題なければ旧デプロイをアーカイブ

---

## 📋 適用手順

### Step 1: 現行 GAS の snapshot 取得 (ロールバック用)

1. GAS エディタを開く (該当スクリプトを Apps Script で表示)
2. Editor 左サイドバー → 「デプロイ」→「デプロイを管理」
3. 現在の active deployment の **Deployment ID** と **Web App URL** をメモ
4. Editor 右上「時計アイコン」(バージョン履歴)→ 最新スナップショットに **「v9.3 before generic handler」** などタイトルを付けて保存
5. **バックアップとして v9.0 / v9.3 のコードを別ファイル (Google ドライブ内等) にコピーして保存**

```
メモテンプレート:
旧デプロイ ID: AKfyc.......................
旧 URL: https://script.google.com/macros/s/AKfyc.../exec
スナップショット名: v9.3_pre_generic_handler_YYYY-MM-DD
```

### Step 2: v9.4 のコード貼り付け

1. `c:/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working/gas-bonus-code-v9.4.js` をテキストエディタで開く
2. 全文コピー
3. GAS Editor の `コード.gs` (または現行のメインスクリプト) に **全置換貼り付け**
4. 保存 (Ctrl+S)

### Step 3: GAS 内で単体テスト

Apps Script Editor の関数ドロップダウンから実行 → **「ログを表示」で成功確認**:

```
(a) testAllSheetConnections
    → 全シート ✓ Found になることを確認
    → ログに tenant_default シート一覧が出る

(b) testRecordToStepupSheet (既存 case のリグレッション)
    → BC_ステップアップ シートに "testUser / スペシャルステップ / 申請済み" が追記される
    → 別の case も 1-2 つ試す (testRecordToAkeomeSheet 等)

(c) testGenericHandler (新 v9.4 の検証)
    → まず スプレッドシートに手動で "BC_テストイベント" タブを作成
       行1: 結合セル「BC_テストイベント」
       行2: 「申請日時 / ユーザーID / ボーナスコード / ステータス」
    → testGenericHandler を実行
    → BC_テストイベント シートに testUser_v94 / テストコード / 申請済み が書かれていれば成功
```

### Step 4: 本番デプロイ (新しいデプロイ)

1. GAS Editor 右上「デプロイ」→「新しいデプロイ」
2. デプロイの種類: **ウェブアプリ**
3. 設定:
   - 説明: `v9.4 Generic Handler added YYYY-MM-DD`
   - 次のユーザーとして実行: **自分 (スクリプト所有者)**
   - アクセスできるユーザー: **全員** (既存と同じ)
4. 「デプロイ」クリック → **新しい Web App URL** を取得
5. 新 URL をメモ

```
新 URL: https://script.google.com/macros/s/AKfyc.../exec
デプロイ ID: ________________________________
```

### Step 5: 新 URL の疎通確認

ブラウザまたは curl で GET:

```bash
curl "https://script.google.com/macros/s/AKfyc.../exec"
# 期待レスポンス:
# {"status":"ok","message":"Bonus Code Webhook v9.4 is running",
#  "spreadsheet":"スロット天国_イベントシート","genericHandler":true}
```

`v9.4 is running` と `genericHandler:true` が見えれば OK。

### Step 6: sloten-standalone 側で URL を切替

管理画面 (`sloten-admin-secure.pages.dev`) →「運用・監視」→「GAS URL」タブ

1. **旧 URL をメモ** (バックアップ用)
2. `BONUS_CODE_WEBHOOK_URL` の値を Step 4 で取得した **新 URL に更新**
3. 保存
4. 同じタブの「ping」ボタンで疎通確認 → 2xx + body に `v9.4 is running`

### Step 7: 本番 canary テスト

実ユーザーの顧客サポート会話で、**既存** の bonus code を 1 件使ってテスト:

```
顧客役 (テストユーザー) が widget から "スロ天ドリーム" を入力
  ↓
sloten-standalone が新 URL (v9.4) に POST
  ↓
GAS v9.4 の case 'BC_ギルド' が hit → recordToGuildSheet
  ↓
BC_ギルド シートに記録される
```

これが既存通り動けば既存 event には影響なしと確認。

---

## 🧪 Generic Handler の検証 (v9.4 の真価を確かめる)

新 event を追加せず運用で自然に使う前に、一度 dry run で検証:

### テストフロー

1. スプレッドシートに **仮のテストシート** を作成: `BC_GENERIC_TEST`
   - 行1: 結合セル「Generic Handler 動作確認用」
   - 行2: `申請日時 | ユーザーID | ボーナスコード | ステータス`

2. sloten-standalone 管理画面で **テスト用 bonus_code** を作成:
   - `type_key`: `test_generic`
   - `display_name`: Generic テスト
   - `codes`: `["GENERICテスト"]`
   - `success_content`: 「テスト受付」
   - `gas_type`: **`BC_GENERIC_TEST`** ← シート名と一致
   - `enabled`: 1

3. widget から `GENERICテスト` を送信

4. 確認:
   - `BC_GENERIC_TEST` シートの 3 行目に記録されている → ✅ Generic Handler 動作
   - GAS Logger で `Recorded to generic sheet "BC_GENERIC_TEST":...` が出ている

5. 後片付け:
   - テスト bonus_code を削除
   - `BC_GENERIC_TEST` シートは保持してもよい (将来の再検証用)

---

## 🚨 ロールバック手順

v9.4 で問題が出た場合:

### 選択肢 A: sloten-standalone 側で URL を旧 URL に戻す (即効性、推奨)

管理画面で `BONUS_CODE_WEBHOOK_URL` を **Step 6 でメモした旧 URL** に戻す。
→ 旧 GAS (v9.3) デプロイが再び active に (そもそも削除していない)
→ sloten-standalone は変更なし、デプロイ不要

### 選択肢 B: GAS 側で旧バージョンにロールバック

1. Apps Script Editor → デプロイ → 「デプロイを管理」
2. 旧 deployment のアーカイブから「このデプロイを有効化」
3. または、Editor のバージョン履歴から Step 1 で保存した「v9.3_pre_generic_handler_YYYY-MM-DD」を復元
4. 新たにデプロイし直して URL 発行 → sloten-standalone で URL 更新

選択肢 A の方が早い (30 秒)。B は GAS の状態を完全に戻す必要がある時のみ。

---

## ✅ 完了チェックリスト

デプロイ後:

- [ ] Step 5: curl で `v9.4 is running` を確認
- [ ] Step 6: sloten-standalone の URL 切替完了、ping で 200
- [ ] Step 7: 既存 event (例: `BC_ギルド`) 1 件テストして対応シートに記録
- [ ] Generic Handler 検証: `BC_GENERIC_TEST` で dry run 成功
- [ ] 24h 後: 業務時間中に bonus code 送信の audit_log を見て異常なし

完了後の状態:
- 新イベント追加時は **スプレッドシート新タブ作成 + sloten-standalone 管理画面で bonus_code 作成** の 2 step のみ
- GAS コード触らず、GAS 再デプロイ不要、GAS URL 不変

---

## 📖 関連

- 実装根拠: [`08-gas-urls.md`](08-gas-urls.md) §「新ボーナスコード追加時の GAS 側対応」
- 判断項目: [`07-open-questions.md Q7B`](07-open-questions.md)
- ソースコード: `c:/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working/gas-bonus-code-v9.4.js`
- 差分: v9.0 (≡v9.3) → v9.4、 +95 行 (コメント含む)、全 case はそのまま、default のみ generic ルート化
