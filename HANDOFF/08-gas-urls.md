# 08. GAS Webhook URL の扱いと運用手順

本ブランチでは **GAS URL 自体の値は変更していない**。ただし URL を扱うコードが複数箇所変わっているため、デプロイ前後に URL の健全性を確認する必要がある。

---

## 🎯 管理されている GAS URL 一覧 (5 本)

| キー | 用途 | 発火タイミング | 影響範囲 |
|------|------|--------------|----------|
| `GAS_BOT_WEBHOOK_URL` | 一般 bot ハンドオフ (有人切替等) | bot-flows.mjs webhook step (`{{env.GAS_BOT_WEBHOOK_URL}}`) | 業務エスカレーション |
| `BANK_TRANSFER_BOT_WEBHOOK_URL` | 銀行振込 deposit flow | 同上 | 入金処理 |
| `EC_DEPOSIT_BOT_WEBHOOK_URL` | EC 系 deposit flow | 同上 | 入金処理 |
| `BONUS_CODE_WEBHOOK_URL` | ボーナスコード照合 | `src/bonus-codes.mjs forwardToGas` | ボーナス付与 |
| `OPERATOR_ATTACHMENT_WEBHOOK_URL` | スタッフからの添付送信通知 | `src/handlers/messages-native.mjs` | 添付転送 |

定義元: [`src/env-resolver.mjs`](../src/env-resolver.mjs) の `OVERRIDABLE_KEYS` 配列。

---

## 💾 保存箇所 (2 系統)

各 URL は以下のいずれか (または両方) に保存されており、**DB override が優先**:

### 1. 静的 env binding (wrangler secret)

```bash
wrangler secret list
# GAS_BOT_WEBHOOK_URL
# BANK_TRANSFER_BOT_WEBHOOK_URL
# ...
```

- デプロイに組み込まれる
- 変更には `wrangler secret put` + 再デプロイが必要
- 通常これがフォールバックの役割

### 2. D1 `env_overrides` テーブル (admin UI から設定)

```bash
wrangler d1 execute sloten_standalone_db --remote \
  --command="SELECT key, SUBSTR(value, 1, 60) || '...' AS value_preview, updated_by, updated_at FROM env_overrides WHERE key LIKE '%WEBHOOK%' ORDER BY key;"
```

- 管理画面 `/admin` → 「運用・監視」→「GAS URL」から set / clear 可能
- **こちらが優先** (あれば static env の値より優先される)
- 30 秒の in-process キャッシュ (`env-resolver.mjs` の CACHE_TTL_MS)

---

## 🔧 コードレベルの変更 (本ブランチで入ったもの)

### 変更 1: 保存時の URL 検証 (admin-ops.mjs `setGasUrl`)

**Before**: `https?://` で始まれば何でも保存可
**After**: `isSafeOutboundUrl(value, env)` で拒否判定

拒否されるパターン:
- `http://localhost/*`, `http://127.*`
- `http://10.*`, `http://172.16-31.*`, `http://192.168.*`
- `http://169.254.*` (AWS IMDS)
- `http://100.64-127.*` (CGNAT)
- IPv6 ULA `[fc00::]`, `[fe80::]`
- `*.internal`, `*.local`, `metadata.google.internal`
- `env.ALLOWED_WEBHOOK_HOSTS` 設定時はそれ以外の全ホスト

### 変更 2: 実 fetch 時の URL 検証 (保険的二重チェック)

以下の fetch 発火ポイントで `isSafeOutboundUrl` を再検証:
- `src/bonus-codes.mjs:95` — BONUS_CODE_WEBHOOK_URL
- `src/handlers/messages-native.mjs:131` — OPERATOR_ATTACHMENT_WEBHOOK_URL
- `src/handlers/bot-flows.mjs:474` — webhook step (GAS_BOT / BANK_TRANSFER / EC_DEPOSIT 全て)

**不合格なら webhook 送信を silently スキップ** (warn ログのみ)。

### 変更 3: ping エンドポイントも検証

`POST /api/admin/gas-urls/ping` が `isSafeOutboundUrl` 通過を要求。
不合格なら `400 "Configured URL no longer passes safety check — not pinging"`。

### 変更 4: 応答 body の読み込み制限

- `BONUS_CODE_WEBHOOK_URL` 応答: `readBounded(response, 4000)` で 4KB までに制限
- 全 webhook fetch: 10 秒 timeout 明示化
- 過去は default 30s、応答サイズ無制限 (OOM リスク)

### 変更 5: `OPERATOR_ATTACHMENT_WEBHOOK_URL` の添付 URL TTL 短縮

- Before: signed attachment URL の TTL = 24 時間
- After: この webhook 専用で **10 分**
- 運用 GAS が受信後すぐ fetch すれば問題なし

### 変更 6: `env_overrides` の allowlist 強化

`src/env-resolver.mjs` の `getEnvValue()` が `OVERRIDABLE_KEYS` に無いキーでは DB lookup を skip。
→ 将来の code regression で `SESSION_SIGNING_KEY` などを DB から読もうとしても拾わない。
→ **5 本の GAS URL のみが DB override 対象**。

---

## ✅ デプロイ前チェックリスト (GAS URL)

### C1. 現在保存されている URL の確認

```bash
wrangler d1 execute sloten_standalone_db --remote --command="
  SELECT key, value, updated_by, updated_at
    FROM env_overrides
   WHERE key LIKE '%WEBHOOK_URL'
   ORDER BY key;"
```

出力例の期待形:
```
key                                value                                               updated_by
───────────────────────────────────────────────────────────────────────────────────────────────
BANK_TRANSFER_BOT_WEBHOOK_URL     https://script.google.com/macros/s/AKfyc.../exec    admin@...
BONUS_CODE_WEBHOOK_URL            https://script.google.com/macros/s/AKfyc.../exec    admin@...
EC_DEPOSIT_BOT_WEBHOOK_URL        https://script.google.com/macros/s/AKfyc.../exec    admin@...
GAS_BOT_WEBHOOK_URL               https://script.google.com/macros/s/AKfyc.../exec    admin@...
OPERATOR_ATTACHMENT_WEBHOOK_URL   https://script.google.com/macros/s/AKfyc.../exec    admin@...
```

### C2. 各 URL が新 `isSafeOutboundUrl` に通るかローカル検証

```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone-overnight-2026-04-17-2311

# 上記 C1 で取得した URL を 1 つずつ検証
node --input-type=module -e "
import { isSafeOutboundUrl } from './src/safe-url.mjs';
const urls = [
  'https://script.google.com/macros/s/AKfycbx.../exec',  // 実 URL に置換
  // ... 他の 4 本も
];
// ALLOWED_WEBHOOK_HOSTS を設定する予定の場合はここでシミュレート
const env = { ALLOWED_WEBHOOK_HOSTS: 'script.google.com,sloten.io' };
for (const u of urls) {
  console.log(isSafeOutboundUrl(u, env) ? '✓' : '✗', u);
}
"
```

**全て ✓ になることを確認**。1 つでも ✗ があれば ALLOWED_WEBHOOK_HOSTS に含めるか、ALLOWED_WEBHOOK_HOSTS 自体を設定しない判断が必要。

### C3. 静的 env (wrangler secret) のバックアップ確認

```bash
wrangler secret list
# 期待: 上記 5 本が表示される
```

これは実値を表示しないが、存在確認可能。実値の手控えが無い場合は、本番管理者から取得 (または DB override が効いていれば env は使われないので問題なし)。

---

## 🚀 デプロイ直後の GAS URL 動作確認 (必須)

### D1. 管理画面から ping

1. 管理画面 (`sloten-admin-secure.pages.dev`) にログイン (admin ロール)
2. 「運用・監視」→「GAS URL」タブ
3. 各 URL の「ping」ボタンをクリック
4. 5 本とも **2xx + body preview が返る** ことを確認

ping 失敗時のパターン別対応:

| ping 結果 | 原因の可能性 | 対応 |
|-----------|-------------|------|
| 400 "URL no longer passes safety check" | `ALLOWED_WEBHOOK_HOSTS` が strict すぎる | env を修正 or 該当ホスト追加 |
| 404 | GAS script が削除/再デプロイされた | GAS 側の新 URL を取得し管理画面から上書き保存 |
| 5xx | GAS script の内部エラー | GAS 側ログ確認 (本サービス関係なし) |
| timeout | GAS 側の応答遅延 / ネットワーク問題 | GAS 側確認 |

### D2. 本番 D1 で URL 存在確認 (ping 結果とセット)

```bash
# ping 直後の更新時刻を確認
wrangler d1 execute sloten_standalone_db --remote --command="
  SELECT action, resource_id, payload, created_at
    FROM audit_log
   WHERE action = 'gas_url.ping'
   ORDER BY created_at DESC LIMIT 5;"
```

### D3. 実フロー試験 (可能なら)

**最も確実な確認法**: 本番 widget から実際に以下を試す (canary トラフィック 1-2 件):

| フロー | 発火する GAS URL | 確認 |
|--------|------------------|------|
| ボーナスコード入力 → 結果表示 | `BONUS_CODE_WEBHOOK_URL` | submissions テーブルの `gas_forwarded=1` |
| 銀行振込 deposit flow 完走 | `BANK_TRANSFER_BOT_WEBHOOK_URL` | GAS シート側で受信確認 |
| EC 入金 flow 完走 | `EC_DEPOSIT_BOT_WEBHOOK_URL` | 同上 |
| スタッフが添付送信 | `OPERATOR_ATTACHMENT_WEBHOOK_URL` | GAS シート側で受信確認 |
| bot から有人切替 | `GAS_BOT_WEBHOOK_URL` | GAS 側で通知受信確認 |

本番 canary は運用チームと調整。

---

## 🔄 GAS script 再デプロイ時の URL 更新手順

**Google Apps Script は "新しいデプロイ" を作ると URL (`/macros/s/AKfyc.../exec` の部分) が変わる**。
この場合、sloten-standalone 側の URL も差し替えが必要。

### 手順

1. GAS 側で新デプロイを作成し、新 URL をコピー
2. sloten-standalone 管理画面 → 「GAS URL」タブ
3. 該当キーの入力欄に新 URL を貼り付けて保存
4. ping で疎通確認
5. 旧 URL は GAS 側で残しておけば暫くグレースフル (新/旧どちらでも動く期間を設ける)

### ロールバック時の注意

sloten-standalone 側を rollback しても env_overrides テーブルのデータは残る ため、new URL を設定済みの状態で old code が動く場合がある。
new code の isSafeOutboundUrl が old code に無いだけなので、動作は old code の挙動 (何でも通す) に戻る。基本問題なし。

---

## 📋 ALLOWED_WEBHOOK_HOSTS 運用

### 基本方針

| 条件 | 設定推奨 |
|------|---------|
| 全 GAS URL が `script.google.com` でホスト | **設定する**: `"script.google.com"` 単体 |
| 社内 webhook サーバー (例 `webhook.sloten.internal`) も使う | `script.google.com,webhook.sloten.internal` |
| 将来的に URL 増やすかも不明 | **最初は設定しない** → 運用安定してから絞る |

### 追加 / 変更手順

```bash
# 既存値確認 (secret list は値を表示しないので put で上書き)
wrangler secret put ALLOWED_WEBHOOK_HOSTS
# 値: script.google.com,sloten.io

# 再デプロイ (secret 変更は deploy で反映)
npm run deploy

# 動作確認: 新 URL を管理画面から試験保存
# allowlist 外の URL を保存しようとすると:
# 400 "URL not allowed (loopback, private IP, metadata, or not in ALLOWED_WEBHOOK_HOSTS)"
```

### 削除手順

```bash
wrangler secret delete ALLOWED_WEBHOOK_HOSTS
npm run deploy
# → exact-host allowlist が無効に。private IP 拒否など基本チェックは引き続き有効。
```

---

## 🆘 トラブルシューティング

### T1. デプロイ後、ボーナスコード送信が sheet に届かない

```bash
# 1. BONUS_CODE_WEBHOOK_URL が env_overrides に存在するか
wrangler d1 execute sloten_standalone_db --remote \
  --command="SELECT value FROM env_overrides WHERE key='BONUS_CODE_WEBHOOK_URL';"

# 2. ping してみる
curl -X POST https://<worker>/api/admin/gas-urls/ping \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"BONUS_CODE_WEBHOOK_URL"}'

# 3. bonus_code_submissions の gas_forwarded フラグを確認
wrangler d1 execute sloten_standalone_db --remote --command="
  SELECT id, type_key, gas_forwarded, gas_response
    FROM bonus_code_submissions
   ORDER BY created_at DESC LIMIT 5;"

# 4. Worker ログで '[bonus-codes] GAS forward skipped: unsafe URL rejected' が出ていないか確認
wrangler tail --name sloten-standalone 2>&1 | grep -i "bonus\|forward"
```

### T2. 管理画面から URL 保存すると 400 が出る

- 新 `isSafeOutboundUrl` の判定対象確認:
```bash
cd /c/Users/PC/OneDrive/Desktop/sloten-standalone
node --input-type=module -e "
import { isSafeOutboundUrl } from './src/safe-url.mjs';
console.log(isSafeOutboundUrl('<保存しようとした URL>', { ALLOWED_WEBHOOK_HOSTS: '<設定値>' }));
"
```
- false なら、なぜ false か切り分け: `ALLOWED_WEBHOOK_HOSTS` の影響か、private IP 判定か

### T3. pingGasUrl が 400 を返す (既存の URL なのに)

- 原因: 保存時は検証を通ったが、`ALLOWED_WEBHOOK_HOSTS` が後から変更されて不整合
- 対応: `ALLOWED_WEBHOOK_HOSTS` を見直すか、該当 URL を allowlist 内ホストのものに変更

---

## ✅ 引き継ぎ担当のアクションサマリ (GAS URL 関連)

デプロイ前:
- [ ] C1: 本番 D1 で 5 本の URL を確認
- [ ] C2: ローカルで `isSafeOutboundUrl` 検証
- [ ] C3: wrangler secret の存在確認
- [ ] Q1 (07-open-questions.md) で `ALLOWED_WEBHOOK_HOSTS` 設定方針決定

デプロイ後:
- [ ] D1: 管理画面から 5 本とも ping
- [ ] D2: audit_log で ping 実施を確認
- [ ] D3: (可能なら) canary トラフィックで 1 本ずつ実フロー確認

継続運用:
- GAS script 再デプロイ時 → 管理画面から URL 差し替え + ping
- 24h モニタ: `[bonus-codes] GAS forward skipped: unsafe URL rejected` 等の warn ログ監視

---

---

## ⚠️ 重要: 新ボーナスコード追加時の GAS 側対応 (自動化されていない)

**現状、sloten-standalone と GAS コードは疎結合**。bonus_codes への追加は 2 系統に分かれる:

### ケース 1: 既存 `gas_type` を使う (sloten-standalone のみで完結)

例: 新コード追加するが、`gas_type='stepup'` で既存の「BC_ステップアップ」シートに記録したい場合。

**必要作業**: sloten-standalone 管理画面 →「ボーナスコード」→「追加」のみ。**GAS 側作業不要**。

### ケース 2: 新しい `gas_type` = 新しいシートが必要 (手動 6 ステップ)

**GAS 側の自動更新はされていない**。新 event を追加するには:

1. スプレッドシートに新タブ `BC_○○` を作成
2. GAS コードの `SHEET_NAMES` に新キーを追加
3. GAS コードの `doPost` switch に新 `case` を追加
4. GAS コードに `recordTo○○Sheet()` 関数を追加
5. GAS を「新しいデプロイ」→ 新 URL が発行される
6. sloten-standalone 管理画面 →「GAS URL」から新 URL を `BONUS_CODE_WEBHOOK_URL` に保存
7. sloten-standalone で新 `bonus_codes` レコード作成 (`gas_type='○○'` 設定)

**落とし穴**: ステップ (1)-(5) を忘れると、GAS は `default` 分岐に落ちて `BC_ボーナスコード` シートに誤記録。数日後に発覚することも。

### 🟢 改善提案: GAS に Generic Handler を 1 度だけ追加 (推奨) — **v9.4 として実装済み**

**📁 実装ファイル**: `c:/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working/gas-bonus-code-v9.4.js`
**📋 適用手順**: [`09-gas-v94-deploy.md`](09-gas-v94-deploy.md) に詳細記載

GAS 側の `doPost` に以下のフォールバックを追加すれば、**以降の新 event は GAS コード変更不要に**:

```javascript
// doPost switch 文の default: ブロックの直前に追加
default: {
  // Generic fallback: gas_type 名と同じシートが存在すれば、そこに書き込む
  const genericSheetName = bonusType.startsWith('BC_') ? bonusType : 'BC_' + bonusType;
  const genericSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(genericSheetName);
  if (genericSheet) {
    recordToGenericSheet(genericSheet, userId, bonusCode);
    break;
  }
  // シートが存在しない場合は従来通り BC_ボーナスコード に fallback
  recordToBonusCodeSheet(userId, bonusCode, amount);
}

// ファイル末尾に汎用書き込み関数を追加 (4 列標準フォーマット)
function recordToGenericSheet(sheet, userId, bonusCode) {
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  // 行 1=タイトル、行 2=ヘッダー、行 3～=データ の前提
  const aCol = sheet.getRange('A:A').getValues();
  let lastDataRow = 2;
  for (let i = aCol.length - 1; i >= 2; i--) {
    if (aCol[i][0]) { lastDataRow = i + 1; break; }
  }
  // 列: A=申請日時, B=ユーザーID, C=ボーナスコード, D=ステータス
  sheet.getRange(lastDataRow + 1, 1, 1, 4)
       .setValues([[timestamp, userId, bonusCode, '申請済み']]);
}
```

**この改善後の新 event 追加フロー**:
1. スプレッドシートに新タブ `BC_○○` を作成 (行 1 タイトル、行 2 ヘッダーの従来フォーマット)
2. sloten-standalone 管理画面でコード追加 (`gas_type='○○'`)
3. **以上**。GAS 再デプロイ不要、URL 変わらず、env_overrides 触らず

**特殊な列構成 (BC_ボーナスコード の FTD 列、BC_カスタムHS の条件詳細、BC_ひな祭りのコード列なし等) は従来通り個別 `case` を残す**。

**工数**: GAS コード 20 行 + 1 度きりのデプロイ = **約 1 時間**。

### より重い改善案

| 案 | 内容 | 工数 |
|---|------|------|
| B | `clasp` + GitHub Actions で GAS デプロイ CI 化 | 4-8 時間 (初期) |
| C | GAS を廃し、Worker 内で Google Sheets API 直叩き | 数日 |

現状は案 A (generic handler) が圧倒的に ROI 高い。引き継ぎ担当が落ち着いたら検討推奨。

---

## 📖 関連ドキュメント

- 技術詳細: [`04-breaking-changes.md §B9`](04-breaking-changes.md)
- 運用判断: [`07-open-questions.md Q1`](07-open-questions.md)
- コード変更箇所: [`05-files-changed.md`](05-files-changed.md) の `bonus-codes.mjs` / `messages-native.mjs` / `bot-flows.mjs` / `admin-ops.mjs`
