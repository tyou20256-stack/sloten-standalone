# ハイブリッド依存関係マップ

**目的**: sloten-standalone と GAS ボットの責任分担を明文化し、運用中に「これはどこを触るべき？」で迷わないようにする。

**前提**: 2026-04-21 時点で sloten-standalone 本体 (Cloudflare Workers + D1) と 3 本の GAS ボットのハイブリッド構成。完全スタンドアロン化は Phase 2 で OCR 自動入金判定と合わせて検討。

---

## 1. 全体図

```
┌──────────────────── 顧客 (Widget / LIFF) ────────────────────┐
│                                                                │
│                          ↓ HTTP/WS                             │
│                                                                │
│  ┌─────────────── sloten-standalone (Cloudflare) ───────────┐  │
│  │                                                          │  │
│  │  [Widget UI]    [Operator UI]   [Admin UI]               │  │
│  │       │              │               │                   │  │
│  │       ▼              ▼               ▼                   │  │
│  │  [Bot Flow Engine]  [Operator DO]  [Admin API]           │  │
│  │       │                                                  │  │
│  │       ├── bonus code detect → [BONUS_CODE_WEBHOOK_URL]───┼──┐│
│  │       ├── PayPay guidance   → [GAS_BOT_WEBHOOK_URL]─────┼──┤│
│  │       ├── 銀行振込 guidance  → [BANK_TRANSFER_BOT_URL]──┼──┤│
│  │       └── コンビニ guidance  → [EC_DEPOSIT_BOT_URL]─────┼──┤│
│  │                                                          │  │
│  │  [D1: conversations, bonus_codes, env_overrides, ...]    │  │
│  │  [R2: attachments]  [KV: rate-limit]  [DO: live rooms]   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
                         ┌──────────────── GAS (Google Apps Script) ────────────────┐
                         │                                                            │
                         │  📄 gas-bonus-code-v9.4.js  (BONUS_CODE_WEBHOOK_URL)       │
                         │     └→ 27+ シート (BC_ボーナスコード, BC_入学, ...)         │
                         │     └→ v9.4 Generic Handler で新規イベント自動記録         │
                         │                                                            │
                         │  📄 gas-paypay-bot-v3.0.3.js (GAS_BOT_WEBHOOK_URL)         │
                         │     └→ PayPay マネー/ライト 着金確認                        │
                         │     └→ 送金先自動選定 + 入金記録シート                       │
                         │                                                            │
                         │  📄 gas-ec-bot-v2.3.js (EC_DEPOSIT_BOT_WEBHOOK_URL)        │
                         │     └→ コンビニ (STORES) 入金確認                           │
                         │     └→ EC全体 / EC着金確認用D タブ照合                       │
                         │                                                            │
                         │  📄 gas-bank-bot-v2.0.x.js (BANK_TRANSFER_BOT_WEBHOOK_URL)  │
                         │     └→ 銀行振込 着金確認 (action=bank_handoff)              │
                         │     └→ ATM 入金フロー (action=atm_handoff, 同URL再利用)     │
                         └────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                         ┌─ Google Spreadsheet (sloten マスター) ─┐
                         │   - BC_ボーナスコード (共通)             │
                         │   - BC_入学, BC_ギルド, BC_だっちゃん...  │
                         │   - PayPay 入金記録                      │
                         │   - EC全体 / EC着金確認用D                │
                         └──────────────────────────────────────────┘
```

---

## 2. 責任分担マトリクス

| 機能 | sloten-standalone | GAS | スプシ |
|------|:-----------------:|:---:|:------:|
| チャット UI / メッセージ送受信 | ✅ | — | — |
| 顧客認証 (contact_token) | ✅ | — | — |
| Bot Flow Engine (メニュー分岐) | ✅ | — | — |
| ボーナスコード **検出** | ✅ | — | — |
| ボーナスコード **成功メッセージ応答** | ✅ | — | — |
| ボーナスコード **スプシ記入** | — | ✅ (v9.4 Generic) | 書込先 |
| PayPay 入金案内メッセージ | ✅ | — | — |
| PayPay **送金先自動選定** | — | ✅ (v3.0.3) | 参照元 |
| PayPay **着金確認 + 記録** | — | ✅ (v3.0.3) | 書込先 |
| 銀行振込 入金案内メッセージ | ✅ | — | — |
| 銀行振込 **着金確認** | — | ✅ (bank-bot v2.0 `action=bank_handoff`) | 書込先 |
| ATM 入金案内メッセージ | ✅ | — | — |
| ATM **着金確認 (指定振込名義方式)** | — | ✅ (bank-bot v2.0 `action=atm_handoff`) | 書込先 |
| コンビニ入金 案内メッセージ | ✅ | — | — |
| コンビニ **STORES 着金確認** | — | ✅ (v2.3) | 書込先 |
| AI チャット (Gemini) | ✅ | — | — |
| FAQ / KB 検索 | ✅ | — | — |
| Operator Live Chat | ✅ | — | — |
| 管理画面 (Admin UI) | ✅ | — | — |
| 監査ログ (audit_log) | ✅ | — | — |
| Webhook URL 管理 (rotate 可) | ✅ (env_overrides) | — | — |

---

## 3. webhook URL 管理 (allowlist)

**場所**: `src/env-resolver.mjs` の `OVERRIDABLE_KEYS`

```javascript
export const OVERRIDABLE_KEYS = [
  'GAS_BOT_WEBHOOK_URL',            // PayPay
  'BANK_TRANSFER_BOT_WEBHOOK_URL',  // 銀行振込
  'EC_DEPOSIT_BOT_WEBHOOK_URL',     // コンビニ/STORES
  'BONUS_CODE_WEBHOOK_URL',         // ボーナスコード (v9.4)
  'OPERATOR_ATTACHMENT_WEBHOOK_URL',// オペレータ添付通知
];
```

**仕組み**:
1. 管理画面 `/admin` → GAS URL 設定から rotate 可能
2. D1 `env_overrides` テーブルに保存 → `getEnvValue(env, key)` で読取
3. 30秒キャッシュ + 書込時に即座に cache bust
4. `OVERRIDABLE_KEYS` に**列挙されていないキーは上書き不可** (SSRF 類似の attack surface 制限)
5. 全変更は `audit_log.action='gas_url.update'` で記録

**デプロイ不要で GAS URL をローテーションできる** のが最大の利点。

---

## 3.1 GAS Webhook payload contract (2026-04-21 更新)

sloten-standalone の bot flow engine が webhook step で GAS に送る payload フォーマットを、chatwoot-final-working (2026-04-21) の `gas-webhooks.js` と一致させてあります。各 GAS ボットは以下の形式を期待:

| Handoff (flow flag) | URL | Payload body (step.body) |
|---|---|---|
| `handoff_to_gasbot` (PayPay) | `{{env.GAS_BOT_WEBHOOK_URL}}` | `{action:'handoff', payment_method, contact_name:'{{contact.name}}'}` |
| `handoff_to_bank_bot` | `{{env.BANK_TRANSFER_BOT_WEBHOOK_URL}}` | `{action:'bank_handoff', contact_name:'{{contact.name}}', chat_id:'{{contact.id}}'}` |
| `handoff_to_atm_bot` (2026-04-21 新設) | `{{env.BANK_TRANSFER_BOT_WEBHOOK_URL}}` (bank と同一 URL) | `{action:'atm_handoff', contact_name:'{{contact.name}}', chat_id:'{{contact.id}}'}` |
| `ec_start` | `{{env.EC_DEPOSIT_BOT_WEBHOOK_URL}}` (VPS) | 現在は human handoff に暫定退避 (生成器内 TBD) |

bot flow engine (`src/handlers/bot-flows.mjs`) が加える共通フィールド:
- `flow_id`, `flow_name`, `step_id`
- `conversation_id` — GAS は必ずこれで会話を識別
- `contact: {id, name, email, phone}` — 構造化 contact オブジェクト
- `vars` — flow 内変数
- `attachments` — 添付ファイルがあれば signed URL 付き

**フォーマット源泉**: GAS ボット側 `doPost(e).action === 'X'` の switch が dispatch 判定。`action` フィールドが無いと GAS は無視する。

---

## 4. 新規イベント追加時のフロー (Generic Handler)

### Before (v9.3 以前)

```
新イベント追加
  ↓
sloten-standalone にボーナスコード追加 (seed + script)
  ↓
GAS v9.3 に case 'BC_XXX' 追加           ← コード変更
  ↓
GAS デプロイ                                ← 再デプロイ必須
  ↓
スプシに新シート 'BC_XXX' 作成
```

### After (v9.4 Generic Handler)

```
新イベント追加
  ↓
sloten-standalone にボーナスコード追加 (seed + script)
  ↓
スプシに新シート 'BC_XXX' 作成             ← ここだけで済む
  ↓
(GAS 側は `default:` で自動的に新シートに記録)
```

**v9.4 の振る舞い**:
- `bonusType` が明示的な `case` にマッチしなかった場合
  → `SpreadsheetApp.getSheetByName(bonusType || 'BC_' + bonusType)` を試す
  → シートがあれば **4列標準フォーマット** で記録 (申請日時, ユーザーID, ボーナスコード, ステータス)
  → シートがなければ **BC_ボーナスコード** に fallback

**運用手順**:
1. sloten-standalone 管理画面 → ボーナスコード追加 (type_key, gas_type='BC_新イベント')
2. Google Spreadsheet → 新タブ 'BC_新イベント' を作成 (行1: タイトル, 行2: ヘッダー)
3. テスト: 顧客としてボーナスコードを入力 → スプシに記録されることを確認
4. GAS コード変更**不要**、再デプロイ**不要**

---

## 5. 依存関係の「壊れるポイント」早見表

| 変更 | 影響 | 対応 |
|------|------|------|
| GAS webhook URL を rotate | 無し (allowlist + 管理画面で rotate 可) | 管理画面で新 URL 入力 → 即反映 |
| 新ボーナスコード追加 | GAS コード変更**不要** | sloten 側 seed 追加 + スプシに新シート作成 |
| スプシの列構造変更 | GAS 書込みが壊れる | 該当 GAS の write 関数を修正して再デプロイ |
| PayPay API 仕様変更 | gas-paypay-bot が壊れる | gas-paypay-bot-v3.x → v3.y に更新 |
| STORES コンビニ API 仕様変更 | gas-ec-bot が壊れる | gas-ec-bot-v2.x → v2.y に更新 |
| Chatwoot サーバー停止 | **PayPay/EC GAS の Chatwoot API callback が失敗** | ⚠️ 要検討 — §6 参照 |
| CHATWOOT_TOKEN ローテーション | Properties 使用なら無影響 | Script Properties を更新するだけ |
| sloten-standalone webhook 仕様変更 | GAS 側が壊れる可能性 | 該当 GAS のパーサーを確認 |

---

## 6. ⚠️ 未解決: Chatwoot 停止時の影響

**問題**:
gas-paypay-bot と gas-ec-bot は現在 `CHATWOOT_URL = 'https://im.sloten.io'` へ callback して会話状態を更新している。`HANDOFF/12-chatwoot-freeze-decision.md` で Chatwoot 凍結を決定すると、これらの callback が失敗する。

**選択肢**:

**Option A**: Chatwoot を read-only で残す (現在の運用)
- GAS → Chatwoot API callback は動き続ける
- ただし顧客は sloten-standalone を使う (Chatwoot UI 非公開)
- Chatwoot が Chatwoot としての機能を果たさないので無駄

**Option B**: sloten-standalone に Chatwoot 互換 API shim を追加
- gas-paypay-bot / gas-ec-bot 側は無変更で動く
- sloten-standalone 側に `/api/v1/accounts/:aid/conversations/:cid/messages` 等の endpoint を用意
- 実装コスト: 1-2 日

**Option C**: GAS bot 側を sloten-standalone API 対応に書き換え
- GAS コード変更 + 再デプロイ
- 実装コスト: 0.5-1 日/bot × 2 = 1-2 日
- 将来の仕様変更もここで吸収できる

**推奨**: **Option C** (長期的にクリーン、技術的負債が残らない)。Chatwoot 凍結と同時期に実施。

---

## 7. 関連ドキュメント

- `HANDOFF/08-gas-urls.md` — GAS webhook URL のローテーション手順
- `HANDOFF/09-gas-v94-deploy.md` — v9.4 Generic Handler のデプロイ手順
- `HANDOFF/12-chatwoot-freeze-decision.md` — Chatwoot 凍結判断
- `HANDOFF/14-gas-update-sop.md` — **PayPay/EC GAS 更新 SOP (本ドキュメントと連動)**
- `src/env-resolver.mjs` — allowlist 実装
- `src/handlers/admin-ops.mjs` — 管理画面 GAS URL endpoint
