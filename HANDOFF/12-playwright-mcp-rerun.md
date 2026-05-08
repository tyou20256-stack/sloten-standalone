# Playwright MCP セッション起動手順 + v3 完全再走プロンプト

> 2026-05-08 / Reality Checker Critical #1 解消用 (BK 依存ゼロで即実施可能)
> 対象 Worker: `956860de-f16e-40e9-a705-9c4b6932f41e` (現行 staging-bk)

---

## 1. なぜこのテストが優先か

**Reality Checker (5/8 評価):**
> Critical #1 (Playwright 再走) は **BK 依存ゼロで即実施可能** な項目。これを未完のまま CONDITIONAL GO を出すのは過去の「Fantasy Approval」パターンに該当する。

最後の実機 Playwright 検証は Worker `c60d73a4-...` (5/6, 31/33 PASS)。その後 H6 修正 + escalation 修正 + A-J 内部改善 14 件で **コードベース大幅変動**。**回帰リスクの実証 evidence なし** = 本番投入不可。

API 層 (Golden Set 53/53) と curl T4/T7 確認は browser テストの代替にならない。

---

## 2. Playwright MCP セットアップ (5 分)

### Step 1: MCP 追加
```powershell
claude mcp add playwright -- npx -y @playwright/mcp@latest
```

### Step 2: ブラウザインストール (初回のみ)
```powershell
npx -y playwright install chromium
```

### Step 3: 現セッション終了
```
/exit
```

### Step 4: 新ターミナルで Claude Code 起動
```powershell
claude
```

### Step 5: 起動直後に下記プロンプトを貼り付け
(次セクション)

---

## 3. 新セッションへのプロンプト (コピペ用)

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone
Worker version (現行 staging-bk): 956860de-f16e-40e9-a705-9c4b6932f41e
タスク: PLAYWRIGHT-TEST-PLAN-V3.md に基づき v3 ハーネス完全再走

## 必読ドキュメント (この順で読む)
1. C:\Users\PC\OneDrive\Desktop\sloten-standalone\SESSION-HANDOFF-20260507.md (引き継ぎ)
2. C:\Users\PC\OneDrive\Desktop\sloten-standalone\PLAYWRIGHT-TEST-PLAN-V3.md (v3 計画)
3. C:\Users\PC\OneDrive\Desktop\sloten-standalone\HANDOFF\10-webhook-provisioning.md
4. C:\Users\PC\OneDrive\Desktop\sloten-standalone\HANDOFF\11-external-requests.md

## 実行内容
1. v3 ハーネス (getBotMessagesAfterUser / assertResponseContains 15s wait /
   clearCookies) を Playwright MCP で実装
2. T1〜T7 の全 38 ケースを mcp__playwright__browser_* ツール経由で実行
3. wrangler tail を別 bash で並列起動して finishReason / [metrics] / Gemini
   503 を捕捉
4. 結果を C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT-v3-rerun.md に出力

## v3 ハーネスの必須 4 機能
- getBotMessagesAfterUser(): ユーザー送信以降の全 bot msg を結合読み (greet- prefix 除外)
- assertResponseContains(expected, opts): 部分一致 + 15s timeout + 0.5s polling
- clearCookies: 各テスト先頭で context.clearCookies()
- ネットワーク 4xx/5xx capture: page.on('response')

## 期待される改善 (前回 c60d73a4-... と比較)
| ID | 前回 | 期待 | 根拠 |
|---|---|---|---|
| T3-A2 GW期間中の入出金 | FAIL | PASS | jump 抑止追加済 (menu-tree.mjs) |
| T3-D4 英語 | FAIL | PASS | non-Japanese short-circuit (text-classify.mjs) |
| T3-C5 ライセンス | FAIL | PASS | FAQ DB に追加済 |
| T3-B3 バイオハザードヴィレッジ | FAIL | PASS | probe ladder + isKnownMachine |
| T2-1〜5 (greeting filter regression) | FAIL | PASS | v3 ハーネスで厳格化 |
| g-057 なんで何も解決しないんだ | (NEW) | PASS | escalation Frustration patterns 追加 |
| g-059 5万円返してください今すぐ | (NEW) | PASS | escalation 数字付き返金パターン追加 |

## 合格基準
- 全 38 ケース PASS、または FAIL ケース個別にリスク受容書
- T1-8 (CSS pseudo-element chevron) は既知の検出不可なので SKIP 扱い OK
- T3-B3 含む Gemini 系 transient FAIL は 3 回まで retry してそれでも FAIL なら本物 FAIL

## アウトプット形式 (REPORT-v3-rerun.md)
- 結果サマリ (PASS/FAIL/SKIP)
- v1 → v2 → v3-final → v3-rerun の差分表
- 各失敗の (a) 入力 (b) 期待 (c) 実際 (d) wrangler tail で見えた server-side ログ
- 推奨アクション (CRITICAL/HIGH/MEDIUM)
- スクショパス: C:\tmp\sloten-pw-YYYYMMDD-HHMM\screenshots\

## 並列実行 (推奨)
別ターミナルで:
  cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
  npx wrangler tail --config wrangler.staging-bk.toml --format pretty | Tee-Object -FilePath C:\tmp\tail-rerun.log

これで Playwright 実行中の Worker ログが C:\tmp\tail-rerun.log に蓄積され、
失敗時の root cause 分析が即可能。

## 前提
- Playwright MCP は `claude mcp add playwright -- npx -y @playwright/mcp@latest`
  で追加済 (mcp__playwright__* ツール群が利用可能)
- 本セッション内で実行すべきテスト所要時間: 約 30-40 分

## 注意
- staging-bk のみ操作 (本番 sloten-standalone は未デプロイで触れない)
- T4 admin login 前に必ず page.context().clearCookies() (前セッション残存対策)
- T2 のメニュークリックは role-based (input_select の button text) で
  data-testid に依存しない
- T3 では assertResponseContains の timeout を 20s に拡大 (Gemini latency が
  ステージングで p95 7-15s)
```

---

## 4. 結果 evidence 提出フォーマット

新セッション完了後、本セッション (もしくは新規セッション) で以下を共有:

```
Playwright v3-rerun 完了

Worker: 956860de-f16e-40e9-a705-9c4b6932f41e
日時: YYYY-MM-DD HH:MM
結果: NN PASS / NN FAIL / NN SKIP (全 38 件)

レポート: C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT-v3-rerun.md
スクショ: C:\tmp\sloten-pw-YYYYMMDD-HHMM\screenshots\

主要ハイライト:
- v1 比 PASS 数: 25 → __
- v3-final 比改善: __ FAIL → __ FAIL
- 新発見の真のバグ: __ 件 (詳細は report)
- Reality Checker B1-R 解消可否: yes/no
```

---

## 5. このテスト後の Reality Checker 再評価

完了後 Reality Checker 4 回目評価を実行。期待:
- B1-R 解消 → スコア +10pt
- 現状 68 → 78-80 想定
- 残ブロッカー: B2 Webhook (BK 待ち), Telegram secrets

**B2 解消後に再々評価 → 80+ で CONDITIONAL GO 判定可能**。

---

## 6. トラブルシュート

### MCP が認識されない
```powershell
claude mcp list
# playwright が表示されないなら再追加:
claude mcp remove playwright
claude mcp add playwright -- npx -y @playwright/mcp@latest
```

### Chromium インストール失敗
```powershell
# Windows: Edge/Chrome を流用
$env:PLAYWRIGHT_BROWSERS_PATH="C:\Users\$env:USERNAME\AppData\Local\ms-playwright"
npx playwright install chromium --with-deps
```

### staging-bk が応答しない
```powershell
curl https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/api/public/jackpot
# 503 なら Cloudflare 側障害 — 5分待って再実行
```

### wrangler tail が tail されない
```powershell
npx wrangler whoami  # ログイン確認
# 出ていなければ:
npx wrangler login
```
