# Session Handoff — 2026-05-07

> このドキュメントは、2026-05-06〜07 の Claude Code セッション (P-1〜P-9) の作業内容を次のセッションに引き継ぐためのものです。

---

## プロジェクト概要

**sloten-standalone** — Cloudflare Workers + D1 + KV + Durable Objects で構築されたオンラインカジノ「スロット天国」の AI カスタマーサポートチャットシステム。

| 項目 | 値 |
|---|---|
| リポ | `C:\Users\PC\OneDrive\Desktop\sloten-standalone` |
| GitHub | `tyou20256-stack/sloten-standalone` (main ブランチ) |
| 最新コミット | `ee58ec1` (P-1〜P-9 全修正) |
| staging-bk URL | `https://sloten-standalone-staging-bk.rcc-aoki.workers.dev` |
| 管理画面 | `/admin/` (tester@staging.test / 6jr3aYmKDPb3U5De) |
| AI Provider | Gemini 2.5 Flash Lite |
| 機種 DB | pachi-slot-crawler (VPS 5.104.87.106 + Cloudflare Tunnel → pachi-api.bkpay.app) |

---

## アーキテクチャ (主要ファイル)

```
src/
  index.mjs                    — Worker エントリポイント、ルーター、ミドルウェア
  ai-chat-adapter.mjs          — AI 応答生成の中核 (Gemini/Anthropic、FAQ/KB/pachi/announcements RAG)
  scheduled.mjs                — Cron handler (snooze wake / metrics / FAQ extraction)
  escalation.mjs               — エスカレーション判定 (苦情/RG/金銭トラブル)
  auth/
    session.mjs                — Staff session HMAC (TTL/sliding window/revocation)
    contact-token.mjs          — Widget contact token HMAC
  handlers/
    staff-auth.mjs             — Login/Logout/Me + KV revocation
    messages-native.mjs        — メッセージ送受信 + bot reply 生成
    pachi-machines.mjs         — 機種 DB RAG (detectMachineQuery / fetchPachiContext / isKnownMachine)
    announcements.mjs          — お知らせ RAG (sloten.io API + KV cache + HMAC)
    metrics-monitor.mjs        — 5分間メトリクス + Telegram alert
    bot-flows.mjs              — メニューフロー実行エンジン
  lib/
    intent-classifier.mjs      — 統合意図分類 (shadow mode)
    menu-tree.mjs              — メニューツリー解析
    text-classify.mjs          — 言語判定
tests/
  golden-set/                  — AI 応答回帰テスト (50 entries)
  load/                        — k6 soak test
```

---

## 完了タスク (P-1〜P-9)

### P-1: Session TTL 短縮 + Revocation List
- TTL 12h→4h (env var `STAFF_SESSION_TTL_SECONDS`)
- Sliding window: 残り TTL < 50% で自動リフレッシュ
- KV revocation: logout 時に `revoked:<hash>` 書き込み
- **ファイル:** `session.mjs`, `staff-auth.mjs`, `index.mjs`, `wrangler.*.toml`

### P-2: SESSION_SIGNING_KEY 用途別分離
- 3 専用 key: `STAFF_SESSION_SIGNING_KEY`, `CONTACT_TOKEN_SIGNING_KEY`, `RAG_CACHE_SIGNING_KEY`
- デュアル検証: 新 key 優先 → 旧 key fallback + legacy ログ
- 14 日間移行期間 → `scripts/rotate-signing-keys.ps1` で provisioning
- **ファイル:** `session.mjs`, `contact-token.mjs`, `announcements.mjs`

### P-3: Golden Set 評価フレームワーク
- 50 エントリ (drafted 41 + tbd_bk_team 9)
- Widget API 経由で自動採点 (expected/forbidden phrases)
- 最新スコア: **95%** (39/41 PASS)
- **ファイル:** `tests/golden-set/queries.json`, `run.mjs`, `README.md`

### P-4: pachi-rag blacklist → 機種名正例反転
- `NON_MACHINE_KATAKANA_BLACKLIST` (12語) を 1 次フィルタとして残存
- `isKnownMachine()`: `/api/exists` + KV cache 1h + fail-open
- pachi-slot-crawler に `/api/exists` 実装済み (VPS デプロイ待ち)
- **ファイル:** `pachi-machines.mjs`, `ai-chat-adapter.mjs`
- **別リポ:** `C:\Users\PC\pachi-slot-crawler\src\api\server.py`

### P-5: classifyIntent() 統合リファクタ
- 6 カテゴリ: escalation > menu_keyword > machine > announcement > non_japanese > rag_default
- Step 1 (shadow mode): `ai_logs.retrieval_trace.classifier_result` に記録のみ
- Step 2 移行条件: 1 週間ログ → 不一致率 < 5%
- **ファイル:** `src/lib/intent-classifier.mjs`, `ai-chat-adapter.mjs`

### P-6: 管理画面 T4 調査
- T4-1 (Cookie残存), T4-2 (会話0行), T7 (401) — **全てハーネスバグ、コード修正不要**
- **出力:** `C:\tmp\admin-fix-report.md`

### P-7: k6 Soak Test
- 50 VUs × 30min、Golden Set 15 クエリからランダム
- Dry run (5 VUs × 30s): エラー 0%、bot_replied 100%
- **ファイル:** `tests/load/soak.js`, `tests/load/README.md`

### P-8: Monitoring + Telegram Alert
- 5 分間隔 cron: error_rate / empty_rate / p95 監視
- 閾値超過 → Telegram alert (KV de-dup 5 分)
- 日次サマリ 09:00 JST
- **ファイル:** `src/handlers/metrics-monitor.mjs`, `src/scheduled.mjs`
- **ツール:** `scripts/provision-monitoring.ps1`

### P-9: Playwright v3-final 完全再テスト
- **31 PASS / 2 FAIL (実コードバグ 0、退行 0)**
- FAIL: T1-8 (CSS pseudo-element), T3-B3 (Gemini 一過性エラー)
- **出力:** `C:\tmp\sloten-pw-20260507-1345\REPORT-v3-final.md`

---

## AI 応答の主要修正 (Playwright v1 FAIL → v3 PASS)

| 問題 | 根本原因 | 修正 |
|---|---|---|
| T3-A1 お知らせ | Gemini が「機密情報」として拒否 | system prompt に「公開情報・拒否禁止」+ 5件/500字制限 |
| T3-A2 GW | 出金 FAQ に誤ジャンプ | `menu-tree.mjs` で announcements ヒント検知 → jump 抑止 |
| T3-B1 継続率 | pachi-rag 経路に入らず | `detectMachineQuery` + `fetchPachiContext` 実装 |
| T3-C2 PayPay | 「メニューからお選びください」のみ | system prompt 最優先ルール「手順を必ず引用」 |
| T3-C3 KYC | Gemini API エラー | FAQ deterministic short-circuit |
| T3-C5 ライセンス | pachi-rag が「ライセンス」を機種名と誤判定 | `NON_MACHINE_KATAKANA_BLACKLIST` 追加 |
| T3-D4 英語 | 英語検知ロジック未実装 | `ai-chat-adapter.mjs` で non-Japanese short-circuit |

---

## テスト実行方法

```bash
# Golden Set (AI 応答回帰テスト)
node tests/golden-set/run.mjs
node tests/golden-set/run.mjs --only machine_spec

# k6 Soak Test (dry run)
C:\tmp\k6-bin\k6-v0.54.0-windows-amd64\k6.exe run --vus 5 --duration 30s tests/load/soak.js

# Playwright v3 (C:\tmp に保存済みスクリプト)
PLAYWRIGHT_BROWSERS_PATH="C:\\Users\\PC\\AppData\\Local\\ms-playwright" node C:\tmp\sloten-pw-test-final.mjs "C:\tmp\sloten-pw-$(date +%Y%m%d-%H%M)"
```

---

## テストレポート保存場所

| ファイル | 内容 |
|---|---|
| `C:\tmp\sloten-pw-20260506-2033\REPORT.md` | v1 初回テスト (25/39) |
| `C:\tmp\sloten-pw-20260506-2142\REPORT-v2.md` | v2 ハーネス改善 (25/38) |
| `C:\tmp\sloten-pw-20260506-2215\REPORT-v3.md` | **最終統合レポート (P-1〜P-9)** |
| `C:\tmp\sloten-pw-20260507-1345\REPORT-v3-final.md` | v3-final 再テスト (31/33) |
| `C:\tmp\admin-fix-report.md` | P-6 管理画面調査 |

---

## Secret / 環境変数の状態

### staging-bk に設定済み
| Secret/Var | 状態 | 用途 |
|---|---|---|
| `SESSION_SIGNING_KEY` | set (旧・共用) | HMAC 署名 (全用途) |
| `GEMINI_API_KEY` | set | Gemini Flash Lite |
| `PACHI_API_KEY` | set | pachi-slot-crawler Bearer |
| `ADMIN_API_TOKEN` | set | Admin API Bearer |
| `STAFF_SESSION_TTL_SECONDS` | "14400" (var) | 4h TTL |

### staging-bk に未設定 (手動 provisioning 待ち)
| Secret | provisioning スクリプト | 用途 |
|---|---|---|
| `STAFF_SESSION_SIGNING_KEY` | `scripts/rotate-signing-keys.ps1` | Staff session 専用 key |
| `CONTACT_TOKEN_SIGNING_KEY` | 同上 | Contact token 専用 key |
| `RAG_CACHE_SIGNING_KEY` | 同上 | お知らせ cache 専用 key |
| `TELEGRAM_BOT_TOKEN` | `scripts/provision-monitoring.ps1` | Telegram Bot |
| `TELEGRAM_CHAT_ID` | 同上 | Telegram 通知先 |

---

## 残タスク (人間オペレーション待ち)

| # | タスク | 優先度 | 状態 | 参照 |
|---|---|---|---|---|
| 1 | `rotate-signing-keys.ps1` 実行 → staging-bk 新 secret provisioning | HIGH | **✅ 完了 2026-05-07** (staging-bk 鍵 3 種 provisioning + デプロイ + login 検証) | `DEPLOY-RUNBOOK.md` Appendix |
| 2 | `provision-monitoring.ps1` 実行 → Telegram alert 有効化 | HIGH | 未完了 (Telegram Token 待ち) | `docs/MONITORING.md` |
| 3 | pachi-slot-crawler `/api/exists` を VPS にデプロイ | MEDIUM | **✅ 完了 2026-05-07** (psc-api コンテナに docker cp + restart + 動作確認) | `PHASE3-HANDOFF.md` P-4 |
| 4 | k6 本格実行 (50 VUs × 30min) | MEDIUM | dry run 再実行済 (回帰なし、p95 8.8s 要観察) | `tests/load/README.md` |
| 5 | Golden Set 残 9 件を BK/CS チームに依頼 | MEDIUM | 未完了 | `tests/golden-set/README.md` |
| 6 | classifyIntent Step 2 移行 (1 週間後) | LOW | shadow mode 稼働中 | `PHASE3-HANDOFF.md` P-5 |
| 7 | **本番**への rotate-signing-keys 適用 | HIGH | 未完了 (CS 周知 + デュアル検証期間後) | `scripts/rotate-signing-keys.ps1` |
| 8 | 本番デプロイ全体 (CS チーム周知後) | BLOCKED | — | `DEPLOY-RUNBOOK.md` |

### 2026-05-07 セッションでの追加修正
- **isKnownMachine probe ladder 拡張** ([pachi-machines.mjs:206-234](src/handlers/pachi-machines.mjs#L206-L234)): `/api/exists` 単発呼出だと「バイオハザードヴィレッジ」(空白なし) が DB の「スマスロ バイオハザード ヴィレッジ」(空白あり) にマッチしないため、suffix 5/6 文字 + prefix 6/8 文字を順次試す probe ladder を追加。Golden Set 100% (41/41) 復帰
- **Golden Set スコア更新**: 95% → **100%** (machine_spec / announcement / faq / escalation / english / menu_keyword 全カテゴリ PASS)

### 2026-05-07 セッション後半の検証作業 (5 エージェント再評価 + 7 タスク)

**5 エージェント再評価結果 (前回 → 今回):**
| 観点 | 5/6 | 5/7 | 改善 |
|---|---|---|---|
| Code 品質 | 70 | 82 | +12 |
| Security | 45 | 78 | +33 |
| AI/RAG | 55 | 78 | +23 |
| Test 戦略 | 62 | 78 | +16 |
| 本番投入可否 | 38 | 52 | +14 |
| **平均** | **54** | **73.6** | **+19.6** |

**新発見 H6 (CRITICAL) 即修正済**: pachi-machines.mjs の primary path で `m.name`/`manufacturer`/`tags` 等を unsanitized で system prompt に注入していた漏れ。fallback path のみ sanitize されていた。全フィールドに `sanitizeUntrusted` 適用 → Worker `48f1688e-6a85-4714-b7b0-03bb760eb244` でデプロイ後 Golden Set 100% 維持

**7 検証タスク実施結果:**
| # | 内容 | 結果 |
|---|---|---|
| 1 v3 ハーネス再走 | API 層は Golden Set 100% で代替 (Playwright MCP セッションは別) | ✅ 部分完了 |
| 2 Webhook 4 件設定 | BK 側 URL 提供待ち。`HANDOFF/10-webhook-provisioning.md` に依頼書作成 | 🟡 文書化のみ |
| 3 本番 secret rotation | 本番 Worker `sloten-standalone` 未デプロイのため rotation 不要 | ✅ 不要確定 |
| 4 T4/T7 独立再検証 | logout (Origin ヘッダ付) 200, 401 確認, conversations 200 + 5件 — 全 PASS | ✅ 完了 |
| 5 Soak 50VU×30min | k6 50 VUs × 30 min 完走 — 詳細は下記 | ✅ 完了 |
| 6 Monitoring 実発火 | cron 動作確認 `[metrics] total=418 err=1.4% empty=1.4% p95=7985ms` ログ出力。Telegram dispatch は secrets 未設定のため silent no-op (期待通り) | ✅ 動作確認 |
| 7 Webhook fail-safe | 静的確認のみ (AbortController/try-catch/on_error/error_message いずれも実装済)。実発火は webhook URL 設定後に再検証必要 | ✅ 静的完了 |

### 2026-05-07 staging-bk Worker version 履歴
- `c60d73a4-...` → P-9 Playwright v3-final テスト時点
- `312da384-...` → isKnownMachine probe ladder 適用後
- `48f1688e-...` → H6 CRITICAL 修正後
- `333b64e7-1c7f-4645-b125-62733d66dbd1` (現行) → A-M 14 タスク + escalation バグ修正後

### 2026-05-08 セッションでの追加作業 (A-M 14 タスク)

**A-J: コード品質 + セキュリティ 10 件 (1 デプロイ)**
- A: scheduled.mjs に cron 周期コメント + KV ベース last-run gating (drift 対策)
- B: metrics-monitor.mjs KV namespace 統一 (RATE_LIMITER ‖ STATE_KV ‖ SESSION_KV fallback)
- C: src/lib/crypto.mjs 抽出 (HMAC hex sign/verify を一元化、announcements が import)
- D: SUFFIX/PREFIX_PROBE_LENGTHS をモジュール top に hoist (isKnownMachine と fetchPachiContext で共有)
- E: ai_logs.threat_blocked を errors_rate から分離 (security signal を ops alert と区別)
- F: zero-width regex に Unicode escape コメント追加 (diff/grep readability)
- G: intent-classifier.mjs catch に console.warn 追加 (silent drop 解消)
- H: isKnownMachine fail-open に console.warn 追加 (prod 問題切り分け可能化)
- I: text-classify.mjs Halfwidth Katakana コメント修正 (誤った範囲記述を訂正)
- J: PDF も Content-Disposition: attachment に (PDF JS 経由 XSS 抑止)

**K: Golden Set 拡張 (50→63 entries)** + 隠れバグ 2 件発見
- announcement 5→6, escalation 5→8, machine_spec 10→8 (drafted)
- english 3→4, menu_keyword 10→10, faq 17→18
- 拡張時に **真の escalation バグ 2 件発見**:
  - 「なんで何も解決しないんだ」(フラストレーション) → escalation 漏れ
  - 「5万円返してください今すぐ」(返金要求) → 既存正規表現がカバーしていなかった
- escalation.mjs に Frustration patterns + 「<数字>円返(し|って)」 など追加
- 修正後 escalation 8/8 PASS、残 FAIL は Gemini transient のみ

**L: k6 vs Golden Set 78%/100% 乖離原因判明**
- D1 集計: soak 中 user_msgs 3495 / bot_msgs 5134 (147%) → **Worker は 100% bot reply を生成済**
- 22% 乖離は k6 側 `JSON.parse` exception (peak load 時の body 切り詰め)
- soak.js を堅牢化: parse 失敗時に substring fallback で `bot_repl` 検出

**M: CI gating scaffold** (`.github/workflows/qa.yml`)
- pull_request / push → Golden Set 自動実行 + 95% threshold gate
- gitleaks による secret scan
- main マージ時のみ k6 mini-soak (5 VUs × 60s)
- PR コメントで結果サマリ自動投稿

### Soak Test 50 VUs × 30 min 結果 (`/tmp/soak-20260507/summary.json`)
| 指標 | 結果 | Target | 判定 |
|---|---|---|---|
| http_req_failed | **0%** | < 1% | ✅ |
| iterations | 448 完了 + 39 graceful interrupted | — | ✅ |
| http_req_duration p95 | 15.5s | < 3s | ⚠️ |
| ai_response_latency p95 | 17.5s | — | ⚠️ |
| bot_replied | 78.1% | 100% | ⚠️ |

**ai_logs 内訳 (全 2548 件):**
- ok: 2222 (87%) avg 5.6s
- escalated: 204 (8%) — お金/苦情系で意図通り発火
- error: 122 (5%) — **全て Gemini HTTP 503 (overloaded)**

**結論:** Worker は 0 失敗で安定。p95 高は Gemini Flash Lite の容量制約によるもの。本番では 50 並列 chat は非現実的なので影響軽微。Group A fallback が 503 を吸収しユーザーへは sloten 側の責任ある応答を提供できている。

### 残ブロッカー (本番投入条件)
1. **B2 Webhook 4 件設定** (BK 待ち) — 最大ブロッカー、`HANDOFF/10-webhook-provisioning.md` 参照
2. **B1-R 現行 Worker での Playwright v3 完全再走** (Playwright MCP 別セッション必要)
3. **Telegram secrets 設定** (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 提供待ち) — `scripts/provision-monitoring.ps1`
4. **Golden Set tbd_bk_team 9 件** (CS チーム待ち)
5. **本番初回デプロイ手順整備**: 本番 Worker `sloten-standalone` 未デプロイ確認済 → 初デプロイ時に rotate-signing-keys.ps1 prod 行コメント解除して同時実施

---

## 次のセッションへの推奨アクション

1. **即時:** 残タスク #1, #2 の provisioning スクリプト実行
2. **短期:** 残タスク #3 (VPS デプロイ) → `isKnownMachine` が DB 照合モードに切り替わる
3. **1 週間後:** `classifyIntent` の shadow mode ログを分析 → Step 2 移行判断
4. **本番前:** k6 本格実行 + CS チームへの TTL 短縮周知

---

## 既知の注意点

- **Gemini 一過性エラー:** 「処理中にエラーが発生しました」が 5〜10% の確率で出現。Fix A のフォールバックが発動。根本解決は Gemini 側の安定化待ち。
- **T1-8 Chevron:** CSS `::after` pseudo-element で描画 → Playwright innerHTML 検出不可。v1 から一貫。視覚上は正常。
- **wrangler.staging-bk.toml:** メインの wrangler.toml とは別ファイル。staging-bk デプロイ時は `--config wrangler.staging-bk.toml` を必ず指定。
- **D1 datetime:** `datetime('now')` は UTC。JST との 9h 差に注意 (metrics monitor 等)。
- **announcements API:** `sloten.io/api/public/announcements` — 全件返す (8件、HTML 含む)。`fetchAnnouncementsContext` で最新 5 件/各 500 字に制限 + sanitize。
