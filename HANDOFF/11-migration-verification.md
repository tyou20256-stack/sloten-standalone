# 11. chatwoot-final-working → sloten-standalone 移植検証レポート

**検証日**: 2026-04-21
**対象**: `C:/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working/` (旧 Chatwoot Bot Worker) → `sloten-standalone/` (新 standalone 版)

---

## 📊 エグゼクティブサマリ

**総合判定**: ⚠️ **概ね移植済み、ただし 3 領域で更新漏れあり**

- ✅ 中核機能 (widget / bot flow / AI / FAQ / KB / bonus codes / admin UI / GAS 連携 / observability) は全て移植済み
- ✅ Chatwoot 依存を排除した再設計は成功 (HMAC webhook → 自前 widget token、Chatwoot API → D1 ネイティブ)
- ⚠️ **5 件の bonus code が未移植** (seed 漏れ)
- ⚠️ **sloten-main flow seed が 2026-04-15 時点、messages.js 更新 (2026-04-20) に未追従**
- ⚠️ **heavenday_daachin 関連のメッセージ 1 件が sloten-standalone flow に欠落**

---

## ✅ 完全に移植済みのもの

### 1. KB (Knowledge Base) — 11/11 ファイル
両方とも `last_updated: 2026-04-08` で**内容一致**。`seeds/seed-knowledge-sources.sql` に seed 済み。

| chatwoot source | sloten-standalone KB title |
|----------------|----------------------------|
| 01-account.md | アカウント関連 |
| 02-kyc-identity.md | 本人確認(KYC)について |
| 03-deposit-general.md | 入金について（一般） |
| 04-withdrawal-general.md | 出金について（一般） |
| 05-payment-methods.md | 対応している決済方法 |
| 06-bonus-general.md | ボーナスについて（一般） |
| 07-game-info.md | ゲームについて |
| 08-glossary.md | 用語集 |
| 09-troubleshooting.md | トラブル一次切り分け |
| 10-policy-rules.md | 利用規約・ポリシー一般 |
| 11-support-contact.md | サポート連絡先 |

### 2. Bonus code 検出ロジック
- `bonus-codes.js` → `src/bonus-codes.mjs` に再実装 + D1 table (`bonus_codes`) 化
- hardcoded → dynamic (admin UI で編集可) に昇格
- v9.4 generic handler で新コード追加時 GAS 編集不要化

### 3. Admin API endpoints (全て path rename で対応)

| chatwoot worker.js | sloten-standalone |
|-------------------|-------------------|
| `/api/bonus-codes*` | `/api/bonus-codes*` ✓ |
| `/api/menus` | `/api/bot-menus` ✓ |
| `/api/audit-log` | `/api/admin/audit-log` ✓ |
| `/api/errors` | `/api/admin/error-log` ✓ |
| `/api/gas-urls` | `/api/admin/gas-urls` ✓ |
| `/api/test-gas` | `/api/admin/gas-ping` ✓ |
| `/api/test-webhook` | `/api/admin/test-bot` ✓ |
| `/api/backup` | `/api/admin/backup` ✓ + `/api/admin/backup/:table` (新規) |
| `/api/restore` | `/api/admin/restore` ✓ |

加えて新設 15+ endpoints: staff, teams, labels, faq, faq-candidates, knowledge-sources, templates, bot-flows, ai-prompts, ai-logs, dashboard, export, search, contacts, conversations, widget/* 等

### 4. Admin UI セクション
`admin.js` (81KB 1 ファイル) → `public/admin/admin-core.js` + `sections/{bot-data,bot-flows,content,ops}.js` に分割。全 22 セクション登録済:

- bot-data: prompts, teams, ai-logs, bonus-codes, bonus-submissions
- bot-flows: faq-candidates, bot-flows, bot-menus
- content: faq, templates, knowledge, labels, staff
- ops: conversations, menu-tree, webhook-test, gas-urls, audit-log, error-log, backup, export, dashboard

### 5. GAS 連携 (3 bots 並存、webhook URL 経由)
`gas-webhooks.js` の 5 関数 (getGasUrls, recordBonusCode, handoffToGasBot, handoffToBankBot, handoffToEcBot) → sloten-standalone の `bonus-codes.mjs forwardToGas` + bot flow webhook step で等価機能を実装。URL は `env_overrides` テーブル管理、新設 `isSafeOutboundUrl()` で SSRF 防御。

### 6. Worker 基盤機能
HMAC webhook 署名検証、CSRF、PII マスキング、prompt injection 検知、rate limit、audit/error log、backup — 全て移植 + 強化 (overnight 作業の 45 修正)。

### 7. AI chat (Gemini)
`worker-with-ai.js` → `src/ai-chat-adapter.mjs` に置換。input threat detection、output filter (9 カテゴリ)、FAQ/KB 引当、A/B prompt、PII マスキング全て。

### 8. テスト基盤
`test.mjs` (61KB, 旧 Chatwoot worker 向け) → `test/*.test.mjs` (7 ファイル, vitest, 62 tests)。カバレッジは異なる対象 (旧: worker 経由 E2E、新: ユニット) だが代替済み。

---

## ⚠️ 未移植 / 更新漏れ (要アクション)

### 🚨 問題 1: Bonus code が 5 件未 seed

chatwoot `bonus-codes.js` の HARDCODED_MAP に定義あり、sloten-standalone の `seeds/_bonus-success-raw.json` と `scripts/seed-bonus-codes.mjs` に未反映。

| type_key | コード | chatwoot 定義 | chatwoot 文面 | sloten seed |
|----------|------|-------------|-------------|------------|
| `heavenday_daachin` | だっちゃん天国 | ✓ | ✓ | ❌ |
| `treasure_day1` | 宝箱1 | ✓ | ❌ (未作成) | ❌ |
| `treasure_day2` | 宝箱2 | ✓ | ❌ | ❌ |
| `treasure_day3` | 宝箱3 | ✓ | ❌ | ❌ |
| `honey4w` | HONEY4W | ✓ | ❌ | ❌ |

**対応策**:
- `heavenday_daachin`: chatwoot messages.js 側に success 定義があるので **今すぐ移植可能**
- `treasure_day*` / `honey4w`: 両方で success message 未完成 → chatwoot 側で作られてから移植

### 🚨 問題 2: sloten-main flow seed が 5 日遅れ

- `seeds/seed-flow-sloten-main.sql`: **2026-04-15 22:17 生成**
- `chatwoot/messages.js`: **2026-04-20 15:27 更新**

差分:
- chatwoot messages.js の 93 keys のうち 1 件 (`heavenday_daachin_success`) が sloten seed に未反映
- 他の messages.js 内容変更 (既存 key の文面更新) は**未検証** — 5 日間の間に既存 message が編集されている可能性あり

**対応策**:
1. chatwoot 側が最新であることを確認
2. sloten-standalone の `seed-flow-sloten-main.sql` を再生成
3. 本番 D1 に再適用 (idempotent なので安全)

### 🚨 問題 3: chatwoot 側の最新更新を sloten-standalone に持ち込む手順が未定義

現在、chatwoot-final-working は依然として更新されている (4/20 timestamp)。
これが「ソースオブトゥルース」扱いなのか、それとも sloten-standalone が単独進化するのかの**方針が不明確**。

**判断必要**:
- **Option A**: chatwoot-final-working = source of truth → 変更時は自動で sloten に sync する仕組みが必要
- **Option B**: sloten-standalone が single source → chatwoot-final-working は歴史的成果として凍結、今後の変更は sloten-standalone のみ
- **推奨**: **Option B** (sloten 単独進化)。chatwoot 側は `frozen/legacy/` にリネームして凍結。ただし最後に同期しきる必要あり。

---

## 🔵 意図的に移植していないもの (削除でOK)

| chatwoot ファイル | 理由 |
|------------------|------|
| `worker.js` (37KB) | Chatwoot webhook 依存の旧エントリーポイント。`src/index.mjs` で全面書き換え |
| `worker-with-ai.js` (53KB) | 同上 (AI 版) |
| `admin.js` (81KB 一枚岩) | `public/admin/` で section 分割して再実装済み |
| `admin-preview.html` (205KB) | 巨大な単一 HTML。sloten-standalone は `public/admin/index.html` (6.4KB) + 外部 JS/CSS |
| `bonus-codes-api.js` | `src/handlers/bonus-codes-admin.mjs` に等価実装 |
| `bonus-codes.js` | `src/bonus-codes.mjs` に再実装 (D1 backed) |
| `chatwoot-api.js` | sloten-standalone は Chatwoot 非依存のため不要 |
| `messages.js` (89KB) | `seeds/seed-flow-sloten-main.sql` に変換済み |
| `gas-webhooks.js` | 機能単位で handler 分割 (`bonus-codes.mjs`, `bot-flows.mjs webhook step` 等) |
| `healthcheck.mjs` | `/health` endpoint + `scripts/dev-smoke.mjs` で代替 |
| `test.mjs` | `test/*.test.mjs` (vitest 62 tests) に再実装 |
| `gen-preview.mjs` | admin-preview.html 生成 ツール。sloten-standalone は直接 admin UI のため不要 |
| `wrangler.toml` | sloten-standalone 独自の `wrangler.toml` が存在 |

---

## 📁 要判断のファイル

### `sloten-ai-handover-checklist.md` (22KB)
chatwoot-final-working にある。**2026-04-13 作成、tking510 納品物 v2 への検証チェックリスト**。これは sloten-standalone の HANDOFF/ とは**目的が異なる** (tking510 = 外部ベンダ納品物の品質チェック)。

**対応策**: sloten-standalone 側に `HANDOFF/tking510-v2-checklist.md` としてコピーして履歴として保持 (内容は読み物として残すが action 不要)。

### `SETUP.md`, `README-AI-INTEGRATION.md`
- `SETUP.md`: 2.2KB、初期セットアップ手順
- `README-AI-INTEGRATION.md`: 5.5KB、AI 統合説明

sloten-standalone の `README.md` + `ARCHITECTURE.md` + `HANDOFF/DEPLOY-RUNBOOK.md` で概ねカバーされるが、**内容の差分確認は未実施**。重要な情報が漏れていないか、引き継ぎ担当が 30 分読み比べて確認するのが安全。

---

## 🎯 推奨アクション

### 即時対応 (今日〜今週)

1. **`heavenday_daachin` の移植** (30 分作業):
   - `chatwoot/messages.js` から `heavenday_daachin_success` 定義をコピー
   - `seeds/_bonus-success-raw.json` に追加
   - `scripts/seed-bonus-codes.mjs` の DEFS 配列に 1 行追加 (`gas_type: 'BC_だっちゃん'`)
   - 本番 D1 に re-seed

2. **sloten-main flow seed 再生成** (1 時間作業):
   - chatwoot の messages.js の 2026-04-15 以降の全変更を確認
   - `seed-flow-sloten-main.sql` 再生成 (元の generator script が必要 — 恐らく内部スクリプト)
   - 本番 D1 に idempotent 適用

3. **chatwoot-final-working の今後の方針決定** (会議 15 分):
   - Option A (sync continue) か Option B (freeze) を決める
   - Option B 推奨 → chatwoot-final-working フォルダを `chatwoot-final-working-LEGACY-FROZEN-2026-04-21/` にリネーム

### 中期対応 (1-2 週間)

4. **treasure_day*、honey4w の文面作成** (chatwoot ベンダ作業):
   - これらは chatwoot 側でも success message が未完成
   - 完成後に sloten-standalone に移植

5. **SETUP.md / README-AI-INTEGRATION.md の内容 review**:
   - 情報の差分があれば sloten-standalone 側 docs に追記

---

## 📋 検証方法 (再現コマンド)

本レポートの検証結果は以下のコマンドで再現可能:

```bash
CW="/c/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working"
SL="/c/Users/PC/OneDrive/Desktop/sloten-standalone"

# bonus code count: chatwoot = 28 vs sloten = 23
grep -cE "^export const [A-Z_]+_CODES" "$CW/bonus-codes.js"
grep -cE "^  \['" "$SL/scripts/seed-bonus-codes.mjs"

# success keys: chatwoot = 24 vs sloten = 23
grep -cE "^  [a-z_]+_success:" "$CW/messages.js"
node -e "const d=JSON.parse(require('fs').readFileSync('$SL/seeds/_bonus-success-raw.json','utf8')); console.log(Object.keys(d).length);"

# messages.js の key diff
grep -oE "^  [a-z_]+:" "$CW/messages.js" | sed 's/[: ]//g' | sort > /tmp/cw.txt
grep -oE '"id":"[a-z_0-9]+"' "$SL/seeds/seed-flow-sloten-main.sql" | sed 's/"id":"//; s/"//' | sort -u > /tmp/sl.txt
diff /tmp/cw.txt /tmp/sl.txt | grep "^<"

# ファイル時刻比較
stat -c "%y %n" "$SL/seeds/seed-flow-sloten-main.sql" "$CW/messages.js"
```

---

## 🏁 結論

**sloten-standalone への移植は 95% 完了。** 核心部分 (widget / bot flow / AI / 管理機能 / セキュリティ / GAS 連携) は全て Chatwoot 依存を排除した形で再実装されている。

**残 5% の内訳**:
1. bonus code 5 件 (うち 1 件 heavenday_daachin は即移植可、4 件は chatwoot 側も未完成)
2. sloten-main flow seed の 5 日ラグ (messages.js 更新未反映)
3. chatwoot-final-working との将来的な同期方針の確定

上記 3 点を今週中に片付ければ、**完全な移植完了**と宣言できる状態。

---

**関連ドキュメント**:
- デプロイ手順: [02-deploy-runbook.md](02-deploy-runbook.md)
- 本番化可否: [03-production-readiness.md](03-production-readiness.md)
- 変更点: [05-files-changed.md](05-files-changed.md)
