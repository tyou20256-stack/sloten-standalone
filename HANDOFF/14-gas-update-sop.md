# GAS 更新 SOP (Standard Operating Procedure)

**目的**: PayPay / EC / 銀行振込 GAS ボットの更新が必要になる状況と、その手順を標準化する。

**対象**: 運用担当者、GAS 開発者

**前提**: sloten-standalone は Cloudflare Workers 側は CI/CD で自動デプロイされるが、**GAS は手動デプロイ**。

---

## 1. 更新頻度 (実績ベース)

| ボット | 実績更新頻度 | 次回更新の目安 |
|--------|-------------|---------------|
| gas-bonus-code | **0.5 回/月** (v9.4 Generic Handler 以降は激減) | スプシ列構造変更時のみ |
| gas-paypay-bot | **1-2 回/月** (PayPay API 変化 + バグ修正) | 次回 PayPay 仕様通知時 |
| gas-ec-bot | **0.5-1 回/月** (STORES + EC 注文形式変化) | EC 商品構成変更時 |
| gas-bank-* | **0.2 回/月** (銀行 CSV フォーマット変更は稀) | 銀行 UI/API 変更時 |

**合計**: 全 GAS 合わせて **月 2-3 回** の更新頻度。

---

## 2. 更新が必要になるケース

### ケース A: 支払いプロバイダ側の仕様変更
**対象**: gas-paypay-bot, gas-ec-bot

| トリガー | 影響 | 対応 |
|----------|------|------|
| PayPay アプリのレシート表示変更 | OCR / 正規表現が失敗 | gas-paypay-bot の `parseProofImage_` を修正 |
| PayPay 金額表記の変更 (例: 「万」「千」対応) | 金額パース失敗 | `parseAmount_` に NFKC 正規化 + 新表記追加 |
| STORES 注文番号フォーマット変更 | 照合失敗 (G列が空白のまま) | gas-ec-bot の `processCompletedOrders` 修正 |
| PayPay API レスポンス 4xx/5xx 増加 | リトライ頻発 | `fetchWithRetry_` のバックオフ調整 |

**更新所要時間**: 1-4 時間/回

### ケース B: スプレッドシート構造変更
**対象**: 全 GAS

| トリガー | 影響 | 対応 |
|----------|------|------|
| 新しい列追加 (例: 「承認者」欄) | 書込み位置ずれ | `COL` 定数 + `setValues` の列数を更新 |
| シート名変更 (例: 「BC_入学」→「BC_入学2026」) | シート not found | `SHEET_NAME` 定数を更新 |
| タブ順序変更 | 影響なし (getSheetByName 使用) | 無対応 |
| 列の型変更 (テキスト→日付など) | 表示崩れ | `setNumberFormat` 追加 |

**更新所要時間**: 30 分-2 時間/回

### ケース C: sloten-standalone 側の仕様変更
**対象**: gas-paypay-bot, gas-ec-bot (Chatwoot callback を持つ GAS)

| トリガー | 影響 | 対応 |
|----------|------|------|
| sloten-standalone webhook payload 変更 | GAS parser が必要フィールドを取れない | GAS 側 `doPost(e)` パーサー更新 |
| `/api/v1/messages` 送信先 URL 変更 | GAS → sloten callback 失敗 | GAS の `CHATWOOT_URL` → `SLOTEN_API_URL` に変更 |
| 認証方式変更 (Chatwoot api_access_token → sloten JWT) | 401 エラー | GAS の `CHATWOOT_TOKEN` → JWT トークンに変更 |
| イベント名変更 (例: `paypay_deposit_start` → `paypay_initiate`) | GAS が event 判別不可 | GAS の `event` switch 追加 |

**更新所要時間**: 1-3 時間/回

**CAUTION**: これは `HANDOFF/13-hybrid-dependency-map.md` §6 の Chatwoot 停止時に同時発生する。

### ケース D: セキュリティ・運用対応
**対象**: 全 GAS

| トリガー | 影響 | 対応 |
|----------|------|------|
| CHATWOOT_TOKEN / SLOTEN_TOKEN ローテーション | Properties 使用なら**更新不要** | Script Properties を更新するだけ |
| GAS webhook URL 漏洩 | 攻撃者が直接叩ける | 新バージョンを再デプロイ (URL が変わる) → sloten 管理画面で URL 更新 |
| 不正アクセスログ検出 | 潜在的侵害 | 全 Token ローテーション + 新デプロイ |
| Google Workspace アカウント変更 | SpreadsheetApp アクセス不可 | プロジェクトを新アカウントで複製 |

### ケース E: バグ修正
**対象**: 全 GAS

| トリガー | 影響 | 対応 |
|----------|------|------|
| 書込み欠落 (v3.0.2 → v3.0.3) | 10 件に 1 件漏れ | setValues リトライ + flush 追加 |
| LockService デッドロック | 処理停止 | タイムアウト短縮 |
| 競合シート作成 | "already exists" エラー | try/catch + getSheetByName フォールバック |

---

## 3. 更新手順 (標準)

### Step 1: 変更内容の確認
- [ ] どのケース (A-E) に該当するか特定
- [ ] 影響範囲 (どのボット、どの関数) を特定
- [ ] 既存の テスト関数 (`testXxx_()`) で再現できるか確認

### Step 2: ローカル編集
```
1. chatwoot-final-working/gas-{bot-name}-v{X.Y}.js を開く
2. バージョンを v{X.Y+1} にインクリメント (ファイルリネーム)
3. 変更点をコメントヘッダーに追記 (例: v3.0.4: ... を修正)
4. 該当関数を修正
5. テスト関数を実行 (Apps Script エディタで関数選択 → 実行)
```

### Step 3: Apps Script エディタへデプロイ

#### 3a. v9.4 Generic Handler の場合 (bonus-code)
- **再デプロイ不要**。スプシに新タブを作成するだけ。
- 詳細: `HANDOFF/09-gas-v94-deploy.md`

#### 3b. PayPay / EC / 銀行振込 の場合
```
1. script.google.com にアクセス
2. 該当プロジェクトを開く
3. 全文を新バージョンで貼り替え (ファイル名は元のまま)
4. Ctrl+S で保存
5. 「デプロイを管理」→ 既存 Web アプリの鉛筆アイコン
6. 「新バージョン」を選択 → 説明に v3.0.4 等を記入
7. 「デプロイ」クリック
8. **Web アプリ URL が表示される (変更されない)**
```

### Step 4: sloten-standalone 側の URL 確認
```
1. sloten-standalone 管理画面 → GAS URL 設定
2. 該当ボットの URL が現行と一致するか確認
3. 一致しない場合は新 URL を入力して「保存」
   (通常は既存 URL のままで OK。URL が変わるのは「新規デプロイ」を選んだ場合のみ)
```

### Step 5: 本番疎通確認
```
1. 顧客役で widget から入金フローを試す
2. スプシに記録されることを確認
3. sloten-standalone の conversation が自動転送・自動クローズされることを確認
4. エラー時は GAS の「実行」ログを確認
```

### Step 6: 旧バージョンの保管
```
1. chatwoot-final-working/gas-{bot-name}-v{X.Y-1}.js を削除せず保管
2. git commit: "chore: update gas-{bot-name} v{X.Y} → v{X.Y+1}"
3. HANDOFF/14-gas-update-sop.md (本書) に更新履歴を追記
```

---

## 4. 緊急ロールバック手順

GAS 更新後に本番障害が発生した場合:

```
1. Apps Script エディタ → 「デプロイを管理」
2. 「アーカイブ済み」タブを開く
3. 直前のバージョンを選択 → 「再デプロイ」
4. Web アプリ URL は同じなので sloten-standalone 側の設定変更不要
5. 本番疎通確認 → 復旧確認
6. 失敗した変更の原因調査
```

**所要時間**: 5 分以内

---

## 5. 更新履歴

| 日付 | ボット | バージョン | 変更内容 | 担当 |
|------|--------|-----------|----------|------|
| 2026-04-20 | gas-bonus-code | v9.0 → v9.4 | Generic Handler 追加で新イベント追加時 GAS 更新不要に | AI |
| 2026-04-21 | gas-paypay-bot | — | (v3.0.3 for production) | - |
| 2026-04-21 | gas-ec-bot | — | (v2.3 for production) | - |
| YYYY-MM-DD | — | — | — | — |

---

## 6. トラブルシュート FAQ

**Q1. GAS が 500 を返す**
- A1. Apps Script エディタ → 「実行」→「実行数」で最新エラーログを確認。スタックトレースで特定。

**Q2. スプシに記録されない**
- A2. `DEBUG = true` にして再デプロイ → `console.log` を確認。最頻出は `SpreadsheetApp.flush()` が抜けている or シート名不一致。

**Q3. 同じ取引が重複記録される**
- A3. Chatwoot webhook の再送が原因。`LockService` + `取引番号チェック` で防げる。v3.0.0+ は対応済。

**Q4. CHATWOOT_TOKEN が漏れた**
- A4. Chatwoot 管理画面で token を再発行 → Script Properties で CHATWOOT_TOKEN を更新 (再デプロイ不要)。

**Q5. 新しいボーナスコードの場合どうする？**
- A5. **GAS 更新不要**。sloten-standalone 管理画面でコード追加 + スプシに新タブ作成するだけ。詳細は `HANDOFF/09-gas-v94-deploy.md`。

---

## 7. 関連ドキュメント

- `HANDOFF/08-gas-urls.md` — webhook URL 運用手順
- `HANDOFF/09-gas-v94-deploy.md` — v9.4 Generic Handler デプロイ手順
- `HANDOFF/12-chatwoot-freeze-decision.md` — Chatwoot 凍結判断
- `HANDOFF/13-hybrid-dependency-map.md` — ハイブリッド依存関係マップ
- `chatwoot-final-working/gas-*.js` — GAS ソースコード (凍結リポジトリ、参照用)
