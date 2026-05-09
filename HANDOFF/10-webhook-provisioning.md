# Webhook Provisioning Blocker — BK 側依頼書

> 2026-05-07 作成 / 2026-05-09 検証更新 / 本番投入の **Reality Checker B2 ブロッカー** 解消用
> 担当オーナー: rcc.aoki@gmail.com
> 依頼先: BK エンジニアリングチーム

---

## 2026-05-09 staging-bk 検証結果

| Secret | bot_flow 参照箇所 | staging-bk 設定 | 動作 |
|---|---|---|---|
| `GAS_BOT_WEBHOOK_URL` | PayPayマネー / マネーライト (各 flow `paypay_money*`) | ✅ 設定済 | ✅ **動作確認済** ("テストスプレッドシートに記録しました" 応答) |
| `BANK_TRANSFER_BOT_WEBHOOK_URL` | 銀行振込 + ATM (`bank_transfer` / `atm_deposit__webhook`) | ❌ **未設定** | ❌ **fallback 発動** ("ただいま自動案内を準備しています。AIがご質問を承ります") |
| `EC_DEPOSIT_BOT_WEBHOOK_URL` | (現フローで未使用) | ✅ 設定済 (休眠中) | n/a |
| `BONUS_CODE_WEBHOOK_URL` | (現フローで未使用) | ❌ 未設定 (休眠中) | n/a |

**結論**: PayPay 系は staging で動作確認済。銀行振込 + ATM は webhook 失敗 → AI モード退避 (degraded)。
EC_DEPOSIT / BONUS_CODE は将来 flow から参照する想定だが、現フロー定義 (sloten-main / bonus-* / deposit-test) では使われていない。

---

## 概要 (2026-05-07 オリジナル)

sloten-standalone の AI チャットフロー (銀行振込/PayPay/コンビニATM/ボーナスコード申請) は **bot_flows の webhook step 経由で BK 側受付システムに転送**される設計。

現状 **4 つすべての webhook URL が staging-bk に未設定**。本番デプロイ後にこの状態だと、ユーザーが入金/ボーナス申請を完了しようとしても**シルバープラッタ・サイレント失敗**となり、コア動線が機能しない。

---

## 必要な情報 (BK チームから提供してほしい)

| 環境変数名 | 役割 | 例 |
|---|---|---|
| `BANK_TRANSFER_BOT_WEBHOOK_URL` | 銀行振込申請 → BK 受付シート | `https://script.google.com/macros/s/.../exec` 等 |
| `GAS_BOT_WEBHOOK_URL` | PayPay 入金申請 → BK 受付 | 同上 |
| `EC_DEPOSIT_BOT_WEBHOOK_URL` | コンビニ ATM 入金 → BK 受付 | 同上 |
| `BONUS_CODE_WEBHOOK_URL` | ボーナスコード申請 → BK スプレッドシート | 同上 |

各 URL は staging-bk 用と**本番用で別々**に発行をお願いします (テストデータと本番データの混在防止)。

---

## sloten-standalone 側の挙動仕様 (参考)

| 状態 | bot_flows 側の挙動 |
|---|---|
| URL 未設定 | webhook step に到達せずフロー手前で停止 (`AI 待機` モードに移行) |
| URL 設定済 + BK が 200 返却 | 受付完了メッセージ + `set_vars` で次ステップへ |
| URL 設定済 + 8s timeout | `step.error_message` (デフォルト「システム連携でエラーが発生しました。担当者におつなぎします。」) を表示 + `step.on_error` ステップへ |
| URL 設定済 + 5xx | 同上 (catch でエラー処理) |

実装場所: [src/handlers/bot-flows.mjs:497-519](../src/handlers/bot-flows.mjs#L497-L519)

期待される BK 側 webhook の **応答形式**:
```json
{
  "message": "ご申請ありがとうございます。3 営業日以内にお振込ください。",
  "set_vars": {
    "deposit_request_id": "DEP-12345"
  },
  "next": "deposit_done"
}
```

`message` / `set_vars` / `next` はすべて optional。最低限 `200 OK` で空 JSON `{}` でも動作します。

---

## 設定方法 (URL 提供後)

```powershell
cd C:\Users\PC\OneDrive\Desktop\sloten-standalone

# staging-bk に設定
echo "<URL>" | npx wrangler secret put BANK_TRANSFER_BOT_WEBHOOK_URL --config wrangler.staging-bk.toml
echo "<URL>" | npx wrangler secret put GAS_BOT_WEBHOOK_URL --config wrangler.staging-bk.toml
echo "<URL>" | npx wrangler secret put EC_DEPOSIT_BOT_WEBHOOK_URL --config wrangler.staging-bk.toml
echo "<URL>" | npx wrangler secret put BONUS_CODE_WEBHOOK_URL --config wrangler.staging-bk.toml

# 疎通確認 (各フローで実トランザクション 1 件ずつ)
node tests/golden-set/run.mjs --only menu_keyword
# その後 BK 側受付システムでデータ到着確認 → screenshot
```

本番側 (`wrangler.toml`) への適用は staging-bk での疎通確認後に同じ手順で。

---

## 疎通確認チェックリスト (DoD)

- [ ] BK から 4 URL 提供済 (staging-bk 用 + 本番用)
- [ ] staging-bk に 4 URL すべて secret put 済
- [ ] `npx wrangler secret list --config wrangler.staging-bk.toml` で 4 つの URL 名前が表示される
- [ ] 銀行振込フロー実行 → 受付メッセージ受信 + BK 側でレコード確認
- [ ] PayPay フロー同上
- [ ] コンビニ ATM フロー同上
- [ ] ボーナスコード申請フロー同上
- [ ] 各疎通結果のスクショを `HANDOFF/webhook-evidence/` に保存
- [ ] DEPLOY-RUNBOOK.md に「webhook 設定済」を追記

---

## ブロッカー解消後の次ステップ (Reality Checker B2 → 完了)

1. Webhook 設定後、Reality Checker 再評価 → 本番接続性 0/20 → 18-20/20 を期待
2. 段階的本番投入プランの Stage 0 (内部 5 名) 開始可能
3. v3 ハーネスを webhook 込みで再走 → 真の end-to-end 検証
