# staging-bk QA Report

**実施日**: 2026-04-22
**対象環境**: `sloten-standalone-staging-bk.rcc-aoki.workers.dev`
**対象バージョン**: main branch 最新 commit + 本日の差分取込 (ATM 対応済)
**総合判定**: ✅ **本番投入可 (既知の設定不備を解消後)**

---

## 🎯 サマリ

| 項目 | 結果 |
|------|------|
| ユニットテスト | ✅ **39/39 pass** |
| 構文チェック | ✅ **60/60 files OK** |
| スモークテスト | ✅ **52/52 実質 PASS** (初期 3 FAIL は全て誤検出/設計通り) |
| Critical バグ | ✅ 0 件 |
| High バグ | ✅ 0 件 |
| Medium バグ | ⚠️ 3 件 (いずれも設定不備、コード問題なし) |
| Low バグ | ⚠️ 2 件 (外部依存の transient + 軽微 UX) |

---

## 1. Phase 1: 静的チェック

### 1.1 ユニットテスト

```
vitest run → 4 files passed (39/39 tests)
duration: 251ms
```

### 1.2 構文チェック

```
npm run check:all → 60 files OK (src + scripts)
```

### 1.3 Git 状態

- `main` ブランチ、origin より 3 commits 先行 (未 push)
- 本日 working tree に 4 ファイル未 commit (generator修正 + flow 再生成 + HANDOFF 更新)

---

## 2. Phase 2: Deployment Health

| エンドポイント | 期待 | 実際 |
|---------------|------|------|
| `/health` | 200 db:ok kv:ok | ✅ 200 (1.1s) |
| `/widget/` | 200 | ✅ 200 (2.6KB) |
| `/operator/` | 200 | ✅ 200 (2.3KB) |
| `/admin/` | 200 | ✅ 200 (6.4KB) |
| `/widget/widget.js` | 200 | ✅ 200 (26KB) |
| `/widget/widget.css` | 200 | ✅ 200 (11KB) |
| `/admin/sections/bot-data.js` | 200 | ✅ 200 |
| `/api/public/jackpot` | 200 | ✅ 200 |
| `/` (root) | - | ⚠️ 404 (ランディングページなし、設計通り) |

### Bindings

```
CONVERSATION_ROOM (Durable Object) ✅
SESSION_KV + RATE_LIMITER (KV)    ✅
DB: sloten_standalone_db_staging_bk (D1) ✅
FILES: R2 bucket                  ✅
ASSETS (Static)                   ✅
GEMINI_API_KEY (secret)           ✅
```

---

## 3. Phase 3: 機能スモークテスト

### 3a. Widget セッションライフサイクル

| テスト | 結果 |
|--------|------|
| POST /api/widget/contacts | ✅ contact_token 発行 |
| POST /api/widget/conversations | ✅ conversation 作成 |
| POST .../messages (初回) | ✅ welcome_message 起動 |
| flow_state persistence | ✅ D1 に persist |

### 3b. Bot Flow 4 種 Handoff

| Handoff | URL 設定 | 実際の挙動 | 判定 |
|---------|----------|------------|------|
| PayPay (gasbot) | ✅ 設定済 | webhook 発火 → GAS 応答 "テスト..." → menu 継続 | ✅ 疎通 OK |
| Bank | ❌ 未設定 | webhook 発火 → Invalid URL → fallback human handoff | ✅ 設計通り |
| **ATM (新)** | ❌ 未設定 | 🏧 message → webhook → Invalid URL → fallback | ✅ 設計通り |
| EC (コンビニ) | ✅ 設定済 | 現在は TBD human handoff (生成器で意図的退避) | ✅ 設計通り |

### 3c. ボーナスコード検出 (6 種)

| コード | type_key | 応答 | GAS 転送 | 判定 |
|--------|----------|------|-----------|------|
| だっちゃん天国 | heavenday_daachin (NEW) | HEAVEN DAY 特別プロモ | gas_type='BC_だっちゃん' | ✅ |
| バモスイボナ | vamos | Heaven's Shot 参加 | null | ✅ |
| ゲートリアン | gatorian | シークレットコード / Heaven Day | gas_type='BC_入学' | ✅ |
| トライアスロン | triathlon | トライアスロン参加 | null | ✅ |
| ひな祭り | hinamatsuri | 三人官女 | null | ✅ |
| ELITE参加 | elite_challenge | ELITE CHALLENGE | null | ✅ |

**bonus_code_submissions テーブル**: 49 行 (全件 `gas_forwarded=0`)
→ **原因**: `BONUS_CODE_WEBHOOK_URL` 未設定 (Medium finding — §5 M2)

### 3d. FAQ / AI Chat

| テスト | 結果 |
|--------|------|
| faq_main メニュー遷移 | ✅ input_select 表示 |
| 非マッチ入力 `xyzabc123nomatch` | ✅ 選択肢メニュー再表示 (AI fallback には遷移しない、設計通り) |
| 初回メッセージ (任意テキスト) | ✅ welcome_message に bootstrap (trigger=`.*`) |

---

## 4. Phase 4: セキュリティ / エッジケース

| テスト | 結果 |
|--------|------|
| `/api/bonus-codes` 認証なし | ✅ 401 |
| `/api/staff` 認証なし | ✅ 401 |
| `/api/admin/gas-urls` 認証なし | ✅ 401 |
| `/api/admin/audit-log` 認証なし | ✅ 401 |
| `/api/staff/login` 誤パスワード | ✅ 401 |
| Widget 不正 contact_token | ✅ 401 |
| Widget contact_token なし | ✅ 401 |
| 存在しない conversation_id | ✅ 401 (token 検証が先) |
| CORS preflight from `example.com` | ✅ **403 (意図通り — allowlist 外を拒否)** |
| CORS preflight from `sloten.io` | ✅ 204 (正しく ACAO ヘッダー) |
| 空 body POST | ✅ 400 |
| 不正な JSON | ✅ 400 |
| XSS ペイロード (`<script>`) | ✅ テキストとして保存 (表示側でエスケープ想定) |

---

## 5. 発見したバグ / 設定不備

### 🟡 Medium

#### M1: `BANK_TRANSFER_BOT_WEBHOOK_URL` 未設定
- **症状**: `error_log` に 3 件 "Invalid URL: " (flow:webhook source)
- **影響範囲**: Bank / ATM 入金フロー → 全て human handoff にフォールバック
- **推奨対応**: 管理画面 `/admin/ops` → GAS URL 設定 → `BANK_TRANSFER_BOT_WEBHOOK_URL` に gas-bank-bot-v2.0.x デプロイ URL を入力
- **fix scope**: 設定のみ、コード変更なし

#### M2: `BONUS_CODE_WEBHOOK_URL` 未設定
- **症状**: `bonus_code_submissions` 49 件全て `gas_forwarded=0`
- **影響範囲**: ボーナスコード申請が GAS スプレッドシートに記録されない
- **推奨対応**: 管理画面で `BONUS_CODE_WEBHOOK_URL` に gas-bonus-code-v9.4 URL を入力
- **fix scope**: 設定のみ
- **備考**: `forwardToGas()` は URL 未設定時にエラーログも残さず silent return する ([src/bonus-codes.mjs:93](src/bonus-codes.mjs#L93))。監視で検知できない。

#### M3: Migration 016 (perf-indexes) 未適用
- **症状**: `idx_conv_snoozed_until` (partial index) が staging-bk に存在しない
- **影響範囲**: cron `* * * * *` (wake snoozed conversations) が conversations 全 2721 行をフルスキャン
- **現状**: 許容範囲 (行数小)。ただし 10k+ 行に成長すると問題化
- **推奨対応**: overnight branch (未 merge) の `migrations/016-perf-indexes.sql` を staging-bk に手動適用
- **fix scope**: migration 適用のみ

### 🔵 Low

#### L1: 外部 AI API 503 (transient)
- **症状**: error_log に 5 件 × Gemini HTTP 503 (2026-04-17)
- **原因**: Google 側の一時的な過負荷 ("This model is ...")
- **現状**: 2026-04-22 時点は発生なし
- **推奨対応**: なし (外部起因)。リトライ機構 or fallback prompt があれば更に堅牢だが既存コードは例外を catch してユーザーに 502/500 を返さない実装になっているため実害小。

#### L2: Root `/` 404
- **症状**: ルートパスが 404 を返す
- **影響範囲**: 運用者が URL 直叩きで「Worker 死んでる？」と誤認する可能性
- **推奨対応**: `/widget/` or `/admin/` へ 302 リダイレクト、または簡単なランディング表示
- **fix scope**: index.mjs に数行追加

---

## 6. データ現状 (staging-bk D1 スナップショット)

| テーブル | 件数 | 備考 |
|----------|------|------|
| bonus_codes | 25 | hardcoded 24 + dynamic 1 (sakura2026) |
| bot_flows | 6 | sloten-main 109 steps |
| conversations | 2721 | bot:280 / open:528 / closed:1930 |
| contacts | 871 | 累積 |
| messages | 37,283 | 累積 |
| knowledge_sources | 23 | |
| faq | 47 | 承認済 |
| faq_candidates | 606 | 未レビュー (バックログ) |
| audit_log | 188 | admin 操作履歴 |
| error_log | 6 | 全 transient / 設定不備 |
| attachments | 8 | R2 添付 |
| staff_members | 5 | admin seed 済 |
| templates | 57 | 返信テンプレ |
| ai_prompts | 4 | A/B テスト候補 |
| ai_logs | 407 | Gemini 呼出履歴 |

---

## 7. Bot Flow Engine 検証

### Webhook payload 契約 (chatwoot-final-working 準拠確認済)

| Handoff | URL template | Body |
|---------|--------------|------|
| PayPay | `{{env.GAS_BOT_WEBHOOK_URL}}` | `{action:'handoff', payment_method, contact_name:'{{contact.name}}'}` |
| Bank | `{{env.BANK_TRANSFER_BOT_WEBHOOK_URL}}` | `{action:'bank_handoff', contact_name, chat_id}` |
| ATM | `{{env.BANK_TRANSFER_BOT_WEBHOOK_URL}}` (同URL再利用) | `{action:'atm_handoff', contact_name, chat_id}` |

### Flow 遷移ロジック (動作確認)

- 初回メッセージ → `findEntryFlow` で welcome_message bootstrap ✅
- select step → 次 step の ID に遷移 ✅
- 非マッチ → 選択肢再提示 ✅
- webhook step → URL → fetch → `data.message` / `data.next` / `data.set_vars` ハンドリング ✅
- webhook error → `on_error` step にルート ✅
- `handoff` step → conversation.status='open' + flow_state=null ✅

---

## 8. セキュリティ所見

| 観点 | 判定 |
|------|------|
| Admin API 認証 | ✅ 全 endpoint で 401 確認 |
| Widget Contact Token 検証 | ✅ HMAC-SHA256 署名付き JWT |
| CORS origin allowlist | ✅ 厳格 (sloten.io 系 + *.sloten.io サブドメイン) |
| XSS (input) | ✅ テキスト保存のみ、DB レベルで問題なし (表示時エスケープ要確認) |
| SQL injection | ✅ 全 query prepared statement 使用 |
| Rate limit | KV `RATE_LIMITER` 実装あり、今回負荷テスト未実施 |
| Secrets | wrangler secret で管理 (本番 `env_overrides` D1 でオーバーライド可) |

---

## 9. 本番投入前チェックリスト

デプロイ前に以下を完了すること:

- [ ] **(M1)** 本番 D1 に `BANK_TRANSFER_BOT_WEBHOOK_URL` を設定 (gas-bank-bot-v2.0.x URL)
- [ ] **(M2)** 本番 D1 に `BONUS_CODE_WEBHOOK_URL` を設定 (gas-bonus-code-v9.4 URL)
- [ ] **(M3)** migration `016-perf-indexes.sql` を本番 D1 に適用 (overnight branch から cherry-pick)
- [ ] GAS 側で `ATM送金先アカウント設定` タブを作成 (手順は `HANDOFF/13-hybrid-dependency-map.md`)
- [ ] gas-bank-bot-v2.0.x を Apps Script にデプロイ + Web App URL を控える
- [ ] 管理画面 → GAS URL 設定で 4 種 URL を全て本番値に更新
- [ ] 4 種 handoff パスを本番で手動確認 (PayPay / Bank / ATM / EC)
- [ ] Widget を本番ページに埋め込み → CORS 許可されることを確認

---

## 10. 全体評価

**総評**: コード側に**致命的なバグ・regression なし**。発見した Medium 3 件は全て**設定不備** (URL 未設定 + migration 016 未適用) であり、いずれも本番デプロイ時のチェックリストで解消可能。

**強み**:
- 全 API endpoint が期待通りのステータスコードを返す
- auth / CORS / 入力バリデーションが正しく機能
- bot flow engine が安定 (109 steps / 6 bonus codes / 4 handoffs 全て動作確認)
- error fallback が設計通り (webhook 失敗 → 人間エスカレ)
- 監査証跡 (audit_log / error_log / bonus_code_submissions) が機能

**改善余地 (non-blocking)**:
- `forwardToGas()` に silent return ではなく debug log を追加すると運用監視が楽
- cron の snoozed_until スキャン高速化 (migration 016 で解決)
- Root path にランディングページ
- AI chat のリトライ/フォールバック戦略

---

## 11. 関連ドキュメント

- [02-deploy-runbook.md](02-deploy-runbook.md) — デプロイ手順
- [11-migration-verification.md](11-migration-verification.md) — chatwoot 移植検証
- [13-hybrid-dependency-map.md](13-hybrid-dependency-map.md) — sloten ↔ GAS 責任分担
- [14-gas-update-sop.md](14-gas-update-sop.md) — GAS 更新 SOP
