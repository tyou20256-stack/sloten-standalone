# 別 AI エージェント向けタスクプロンプト集

> sloten-standalone の残作業を別セッション/別エージェントで実行するためのプロンプト集
> 各プロンプトは self-contained — そのまま新セッションに貼り付けて実行可能
> 最終デプロイ Worker: `a1f07f19-a406-4b5c-93b8-cc7331db6fab`
> 作成: 2026-05-06

---

## 使い方

1. 下のプロンプトを 1 つ選んでコピー
2. 新しい Claude Code セッションを起動 (必要なら Playwright MCP 等も追加)
3. プロンプトを貼り付けて実行
4. 完了したら結果を本セッションに戻して次へ

各プロンプトは独立して実行できます。**順序の推奨は最後に記載**。

---

## P-1: Session TTL 短縮 + revocation list 実装

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone (Cloudflare Workers + D1)

タスク: スタッフセッションの TTL を 12h から 4h sliding window に短縮し、
リボケーションリストを KV ベースで実装してください。

## 現状
- src/auth/session.mjs:7 で TTL を定数で定義
- HMAC SHA-256 で sid を署名、KV (SESSION_KV) に保存
- 現状: 失効はトークン期限のみ。ログアウトしても他端末セッションは生存し続ける

## 要件
1. TTL を環境変数 STAFF_SESSION_TTL_SECONDS (デフォルト 14400 = 4h) で読めるように
2. sliding window: verifySession() で正常検証時にトークンを再発行 (新しい署名タイムスタンプ)
3. revocation list:
   - logout() で `kv.put("revoked:" + sid, "1", { expirationTtl: 元の TTL })`
   - verifySession() の最後で `if (await kv.get("revoked:" + sid)) return null`
4. KV namespace は SESSION_KV を使用 (既存)
5. 既存セッションを破壊しないこと — 新コードは旧 sid もそのまま検証できる

## Done 定義
- [ ] src/auth/session.mjs を変更
- [ ] env.STAFF_SESSION_TTL_SECONDS を wrangler.staging-bk.toml と wrangler.toml の [vars] に追加
- [ ] logout endpoint (src/handlers/staff-auth.mjs 等) でリボケーションリスト書き込み
- [ ] テスト: ログイン → revoke → 同 sid で API 叩いて 401 が返ること
- [ ] staging-bk にデプロイ
- [ ] 本番 wrangler.toml には var だけ追加、デプロイは保留

## 注意
- 短縮による業務影響あり — 本番デプロイは別途 Sloten CS チームへの周知が前提
- 本番には**デプロイしない**こと (staging-bk のみ)
- 検証 KV read レイテンシは +30-50ms。許容範囲だが p99 が悪化したら revert

## 関連ファイル
- src/auth/session.mjs
- src/auth/contact-token.mjs (参考: 同じパターン)
- src/handlers/staff-auth.mjs (logout endpoint)
- wrangler.staging-bk.toml
```

---

## P-2: SESSION_SIGNING_KEY 用途別分離

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

タスク: 単一の SESSION_SIGNING_KEY を 3 用途 (staff session / contact token /
RAG cache) に分離し、デュアル検証期間付きで段階移行してください。

## 現状
- env.SESSION_SIGNING_KEY が以下 3 用途で共用:
  1. src/auth/session.mjs — staff session HMAC
  2. src/auth/contact-token.mjs — widget contact token HMAC
  3. src/handlers/announcements.mjs:97-115 (HMAC_CONTEXT='announcements:v1:hmac') — KV cache HMAC

## 要件
1. 新しい secret 名:
   - STAFF_SESSION_SIGNING_KEY (32B random)
   - CONTACT_TOKEN_SIGNING_KEY (32B random)
   - RAG_CACHE_SIGNING_KEY (32B random)
2. デュアル検証: 各検証経路で
   - 新 key で sign — 失敗時に旧 SESSION_SIGNING_KEY で検証
   - 旧 key で検証成功した場合、ログ出力 (移行進捗観察)
3. 新 key を staging-bk に provisioning する PowerShell スクリプトを書く (実行はしない)
4. 環境変数の不在時: 旧 SESSION_SIGNING_KEY にフォールバック (互換性確保)

## Done 定義
- [ ] src/auth/session.mjs を新 key 優先 + 旧 key fallback に
- [ ] src/auth/contact-token.mjs 同上
- [ ] src/handlers/announcements.mjs 同上
- [ ] scripts/rotate-signing-keys.ps1 を作成 (3 つの新 key を openssl で生成 → wrangler secret put へパイプ)
- [ ] スクリプトに staging-bk と prod の両方への apply コマンドをコメントとして含める (実行はしない)
- [ ] staging-bk にコードのみデプロイ → secret 未設定時にも動作することを確認
- [ ] README に移行手順を追記 (デュアル検証期間 14 日後に旧 fallback コードを削除する手順)

## 関連ファイル
- src/auth/session.mjs
- src/auth/contact-token.mjs
- src/handlers/announcements.mjs
- wrangler.staging-bk.toml
```

---

## P-3: Golden Set 評価フレームワーク + サンプル 30 件

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

タスク: Golden Set 評価フレームワーク + 既存リソースから 30 サンプル
クエリをドラフト作成してください。残り 20 件は BK / Sloten CS チームに
依頼するためのテンプレートを残してください。

## 背景
- AI チャット応答の回帰テスト基盤がない
- 修正のたびに「壊れていないか」を手動 Playwright で見ているが信頼性低い
- Golden Set があれば: 修正前 baseline → 修正後 → diff で regression 検出

## 要件
1. tests/golden-set/queries.json — 50 entries の JSON 配列
   - id: g-001 〜 g-050
   - category: machine_spec / announcement / faq / escalation / english / menu_keyword
   - input: ユーザー入力 (string)
   - expected_phrases: string[] (応答に含まれるべきキーワード OR 条件)
   - forbidden_phrases: string[] (含まれてはいけない)
   - expected_handoff: bool
   - expected_jump: string | null (期待される step_id)
   - source: "drafted" | "from_test_v2" | "from_faq_db" | "tbd_bk_team"
2. tests/golden-set/run.mjs — 評価ランナー
   - queries.json を読み込む
   - 各エントリを generateBotReply (またはステージング API 経由) で実行
   - 採点: expected_phrases AND condition + forbidden_phrases NOT condition
   - 出力: tests/golden-set/results-YYYYMMDD.json + 表形式の summary
   - PASS/FAIL/SKIP (input が tbd_bk_team の場合)
3. データソース (drafted の素材):
   - C:\tmp\sloten-pw-20260506-2033\REPORT.md / REPORT-v2.md の入力リスト
   - C:\Users\PC\OneDrive\Desktop\sloten-standalone\AI-AGENT-TEST-PROMPT.md の AI テストパターン
   - D1 上の faq テーブル (npx wrangler d1 execute sloten_standalone_db_staging_bk --config wrangler.staging-bk.toml --remote --command="SELECT question FROM faq WHERE is_active=1 LIMIT 30")

## カテゴリ別件数
- machine_spec: 10件 (drafted: 6、tbd_bk: 4 — 実際の機種名質問が必要)
- announcement: 5件 (drafted: 3、tbd_bk: 2)
- faq: 15件 (drafted: 12、tbd_bk: 3 — エッジケース)
- escalation: 5件 (drafted: 5)
- english: 3件 (drafted: 3)
- menu_keyword: 12件 (drafted: 10、tbd_bk: 2)

合計: drafted 39件 + tbd_bk 11件 = 50件 (実際は柔軟に)

## Done 定義
- [ ] tests/golden-set/queries.json を作成 (drafted 30+ 件)
- [ ] tests/golden-set/run.mjs を作成
- [ ] 実行サンプル: node tests/golden-set/run.mjs --base-url https://sloten-standalone-staging-bk.rcc-aoki.workers.dev
- [ ] tests/golden-set/README.md に「BK / CS チームへの依頼内容」を記載
   - tbd_bk_team の 11 件について「実顧客チャットからこういう質問を出してください」のフォーマット
- [ ] 既存ドキュメント PHASE3-HANDOFF.md にこのフレームワーク完成を反映

## 注意
- 実顧客データは扱わない (本番 ai_logs アクセスなし) — drafted は staging テストデータのみ
- queries.json は git commit してよい (機微情報なし)
```

---

## P-4: NON_MACHINE blacklist → 機種名正例反転

```
プロジェクト 1: C:\Users\PC\OneDrive\Desktop\sloten-standalone (本 repo)
プロジェクト 2: C:\Users\PC\pachi-slot-crawler (別 repo、なければ git clone tyou20256-stack/pachi-slot-crawler)

タスク: NON_MACHINE_KATAKANA_BLACKLIST (12 語ハードコード) を、
pachi DB の機種名正例リストとの照合方式に置き換えてください。

## 背景
- src/handlers/pachi-machines.mjs に NON_MACHINE_KATAKANA_BLACKLIST = [12 語] がある
- 「ライセンス」「ログイン」等を pachi 経路から除外するため
- ブラックリスト方式は雪だるま式に増える運用負債
- 解決策: pachi DB に該当機種が実在するか確認するアプローチ

## 要件 — pachi-slot-crawler 側 (Python FastAPI)
1. GET /api/exists?name=<query> エンドポイント追加
   - 軽量: SELECT 1 FROM machines WHERE name LIKE %<query>% LIMIT 1
   - 戻り値: {"exists": bool, "matched_count": number}
   - 認証: 既存 Bearer token (sloten-standalone と同じ PSC_API_KEY)
2. テスト: バイオハザード/ライセンス/モンハン で叩いて期待通り
3. デプロイ: VPS 5.104.87.106:8000

## 要件 — sloten-standalone 側 (Cloudflare Workers)
1. src/handlers/pachi-machines.mjs に isKnownMachine(name, env) 関数追加
   - KV キャッシュ (env.RATE_LIMITER): 1h TTL
   - キー: `pachi:exists:<sha1(name)>` (sha1 で長さ正規化)
   - 値: '1' / '0'
   - キャッシュ miss なら /api/exists を叩く
   - エラー時は false (フェイルセーフ)
2. detectMachineQuery のカタカナ判定で:
   - 既存の NON_MACHINE_KATAKANA_BLACKLIST チェックを残す (高速 short-circuit 用)
   - blacklist にヒットしなかった場合に isKnownMachine() で確認
   - exists = false なら isMachineQuery = false
3. ai_logs.retrieval_trace に pachi_exists_check_result を追加

## Done 定義
- [ ] pachi-slot-crawler に /api/exists 実装 + デプロイ
- [ ] curl https://pachi-api.bkpay.app/api/exists?name=バイオハザード で 200 + exists:true
- [ ] curl https://pachi-api.bkpay.app/api/exists?name=ライセンス で 200 + exists:false
- [ ] sloten-standalone に isKnownMachine 実装 + detectMachineQuery 統合
- [ ] staging-bk にデプロイ
- [ ] テスト: 「ライセンスは何を取得していますか」 → pachi に行かない、FAQ に行く
- [ ] テスト: 「バイオハザード ヴィレッジについて」 → pachi 検索される
- [ ] レイテンシ計測: cache miss 時 +30-50ms、hit 時 +5ms 以内

## 注意
- 既存の hardcoded blacklist は残す (一次フィルタとして安価)
- pachi-slot-crawler への commit 権限が必要 — 持っていなければ実装案を PR ドラフトとして
  C:\Users\PC\OneDrive\Desktop\sloten-standalone\PHASE3-HANDOFF.md に追記して終了
```

---

## P-5: classifyIntent() 統合リファクタ

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

** 前提: P-3 (Golden Set) が完了していること **

タスク: src/ai-chat-adapter.mjs の generateBotReply に分散している 5 つの
意図検知ロジックを classifyIntent() に統合してください。

## 現状の意図検知 (実行順)
1. decideEscalation (escalation.mjs) — お金/法的/オペレーター呼び出し
2. findKeywordMenu (bot-menus.mjs) — キーワード→メニュー直結
3. detectMachineQuery (pachi-machines.mjs) — 機種DB
4. detectAnnouncementQuery (announcements.mjs) — お知らせ
5. isNonJapaneseQuery (lib/text-classify.mjs) — 英語等

## 要件
1. src/lib/intent-classifier.mjs を新規作成
2. classifyIntent(message, env, context) → {
     primary: 'escalation' | 'menu_keyword' | 'machine' | 'announcement' | 'non_japanese' | 'rag_default',
     secondary: [...other matched intents],
     confidence: 0..1,
     evidence: { matched_patterns, scores, ... }
   }
3. 優先順位は固定: escalation > menu_keyword > machine > announcement > non_japanese > rag_default
4. mutual exclusion: machine と announcement が両方マッチしたら primary=machine、secondary=['announcement']
5. generateBotReply を classifyIntent ベースに書き換え
6. 既存の RAG inject ロジックは残す — primary に応じて発火/抑止
7. retrieval_trace に classifier_result を追加 (primary, secondary, confidence)

## 段階的適用 (回帰防止)
- Step 1: classifyIntent を追加するが既存ロジックは温存 (shadow mode)
  → ai_logs に classifier_result を記録するが応答は既存ロジックが担う
  → Golden Set + 1 週間の本番ログで正答率を観察
- Step 2: classifyIntent の判定で実際にルーティング (旧ロジック撤去)
- Step 3: 旧 detector 関数を unexport / 削除

## Done 定義
- [ ] src/lib/intent-classifier.mjs 作成
- [ ] tests/golden-set で全件 PASS (P-3 が完了している前提)
- [ ] generateBotReply で shadow mode 適用 (Step 1)
- [ ] staging-bk にデプロイ
- [ ] ai_logs から classifier_result を抽出するクエリ例を docs/INTENT-CLASSIFIER.md に
- [ ] Step 2 への移行は別タスクとして PHASE3-HANDOFF.md に追記して終了

## 注意
- このリファクタは中核フロー — Golden Set がないと regression 検出不能
- P-3 完了確認: tests/golden-set/queries.json と run.mjs が存在すること
```

---

## P-6: 管理画面 T4 系統修正 (Reality Checker B3)

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

タスク: Playwright v2 テストで FAIL した管理画面の 3 つの問題を修正してください。

## 修正対象

### T4-1: ログイン Cookie 残存
- 症状: 一度ログインすると Cookie がブラウザに残り、次の test session で
  email 入力欄が表示されず Playwright タイムアウト
- 仮説: ログアウト endpoint が Set-Cookie で expire を設定していない、
  または admin パネルのフロントが Cookie 確認時に未ログイン判定をしていない
- 調査: src/handlers/staff-auth.mjs (logout) と admin パネルフロント

### T4-2: 会話一覧 0 行
- 症状: 管理画面ログイン後、conversations 一覧が空表示
- 仮説 1: API /api/admin/conversations が tenant フィルタで 0 件返している
- 仮説 2: SPA がレスポンスを正しく描画していない
- 調査: src/handlers/conversations.mjs の admin route + admin パネルフロント

### T7: /api/staff/me 401
- 症状: widget ページ (https://...workers.dev/widget/) で /api/staff/me が呼ばれて 401
- 仮説: admin パネルの bundle が widget ページに混入、不要な fetch が走っている
- 調査: public/widget/index.html, public/admin/ の bundle 共有状態

## 要件
1. 各問題の根本原因をログ + コード読みで特定
2. 最小修正で解消 (オーバーエンジニアリング禁止)
3. 修正後に再現テスト:
   - T4-1: ログイン → ログアウト → email 入力欄が再表示される
   - T4-2: staging-bk DB に SQL で会話を 1 件作成 → 一覧に表示される
   - T7: widget ページでネットワーク監視 → /api/staff/me が呼ばれない
4. wrangler tail で 401 が消えること確認

## Done 定義
- [ ] T4-1 修正 + 再現テスト PASS
- [ ] T4-2 修正 + 再現テスト PASS
- [ ] T7 修正 + ネットワークログから消失確認
- [ ] staging-bk デプロイ
- [ ] 修正内容の 1-pager を C:\tmp\admin-fix-report.md に出力

## 関連ファイル
- src/handlers/staff-auth.mjs
- src/handlers/conversations.mjs
- public/admin/* (admin SPA)
- public/widget/* (widget bundle)
```

---

## P-7: Soak Test (k6) スクリプト + 実行手順

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

タスク: 50 同時会話 × 30 分の soak test を k6 で構築してください。
k6 がローカルになければ docker run grafana/k6 で実行可能な形に。

## 要件
1. tests/load/soak.js — k6 スクリプト
   - 50 VUs (virtual users)
   - 30 分間継続
   - 各 VU の動作:
     - 会話作成 POST /api/widget/conversations
     - 5-10 件のメッセージ送信 POST /api/widget/messages (intervals 5-30s)
     - 各メッセージは Golden Set からランダム選択 (P-3 完了が前提、なければ
       ハードコード 10 種類)
   - thresholds:
     - http_req_failed < 1%
     - http_req_duration p95 < 3000ms
     - http_req_duration p99 < 8000ms
2. tests/load/README.md — 実行手順
   - ローカル実行: k6 run --vus 50 --duration 30m soak.js
   - Docker 実行: docker run -i grafana/k6 run - < soak.js
   - 結果保存: --out json=results.json
3. 結果サマリのフォーマット (Grafana / 簡易 markdown 表)

## Done 定義
- [ ] tests/load/soak.js を作成
- [ ] tests/load/README.md に実行手順
- [ ] dry run (5 VUs × 30s) を staging-bk に対して実行 → エラー 0
- [ ] 本格 run (50 VUs × 30 min) は別途人間が実行 (cost と時間のため)
- [ ] PHASE3-HANDOFF.md の B4 セクションを「スクリプト用意済、実行待ち」に更新

## 注意
- staging-bk に対して実行 (本番は禁止)
- Cloudflare Workers の rate limit に引っかかる可能性 — 50 VUs はギリギリ
- D1 の write 多発でクォータ超過の可能性 — soak 後に DB クリーンアップスクリプトも
```

---

## P-8: Monitoring + Telegram Alert 構築

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

タスク: 本番投入のための monitoring + alerting 基盤を構築してください。

## 要件
1. Cloudflare Workers Logpush 設定:
   - R2 bucket への push 設定 (wrangler.toml に logpush セクション追加)
   - サンプリングなし、全リクエスト保存
2. ai_logs ベースのメトリクス worker:
   - Cron Trigger 5分おき
   - 直近 5分の ai_logs から:
     - error_rate
     - empty_response_rate
     - escalation_rate
     - p95 latency_ms
   - 閾値超過で Telegram alert
3. Telegram Bot 連携:
   - 既存 chatwoot-bot.rcc-aoki.workers.dev のパターンを流用
   - secret: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
4. 閾値:
   - error_rate > 5%: 警告
   - error_rate > 15%: 緊急
   - empty_response_rate > 10%: 警告
   - p95 > 5000ms: 警告
5. 日次サマリ: 毎日 09:00 JST に前日メトリクスを Telegram に投稿

## Done 定義
- [ ] src/handlers/metrics-monitor.mjs を作成 (cron 経由で起動)
- [ ] wrangler.staging-bk.toml と wrangler.toml の triggers.crons に "* /5 * * * *" 追加
- [ ] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID を staging-bk に provisioning する手順を
  scripts/provision-monitoring.ps1 に記載 (実行はしない)
- [ ] staging-bk にコードのみデプロイ → secret 未設定時は no-op で動作
- [ ] テスト: 手動で fetch して metrics 計算が正しいこと
- [ ] docs/MONITORING.md に閾値とアラート例を文書化

## 注意
- 本番 secret は別途人間が provisioning
- Telegram chat に過剰に投稿しない (rate limit 30 msg/sec、burst 1msg/sec/chat)
- 同じ alert を 5 分以内に重複投稿しない (de-dup)
```

---

## P-9: Playwright v3 ハーネス完全再テスト (Reality Checker B1)

```
プロジェクト: C:\Users\PC\OneDrive\Desktop\sloten-standalone

** 前提: Playwright MCP が利用可能なセッション **

タスク: PLAYWRIGHT-TEST-PLAN-V3.md の v3 ハーネスを実装し、
全テスト 38 件を実行して REPORT-v3-final.md を出力してください。

## 設定
- Worker version: a1f07f19-a406-4b5c-93b8-cc7331db6fab (現時点最新)
- 対象 URL: https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/widget/
- 管理画面: https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/admin/ (tester@staging.test / 6jr3aYmKDPb3U5De)

## 必須実装 (v3 ハーネス)
1. getBotMessagesAfterUser() — ユーザー送信以降の全 bot msg 結合読み (greet- prefix 除外)
2. assertResponseContains(expected, opts) — 部分一致判定 + 15s timeout + 0.5s polling
3. clearCookies — 各テスト先頭で context.clearCookies()
4. ネットワークエラー収集: page.on('response') で 4xx/5xx の URL リスト

## 期待される改善 (v2 比)
- T3-A2 GW → PASS (jump 抑止追加済)
- T3-D4 英語 → PASS (short-circuit 追加済)
- T3-C5 ライセンス → PASS (FAQ 追加済)
- T3-B3 バイオハザード → PASS (prefix/suffix probe 既に実装済)
- T2-1/2/3/5 → PASS (greeting filter v3 で厳格化)

## Done 定義
- [ ] v3 ハーネスを実装
- [ ] PLAYWRIGHT-TEST-PLAN-V3.md の T1〜T7 全 38 件を実行
- [ ] C:\tmp\sloten-pw-YYYYMMDD-HHMM\REPORT-v3-final.md を出力
- [ ] FAIL ケースについて、wrangler tail でサーバ側ログを確認 (別ターミナル)
- [ ] v2→v3 比較表を出力 (どのテストが改善/回帰したか)

## 出力形式
| ID | v1 | v2 | v3 | 修正効果 |
|---|---|---|---|---|
| T3-A2 | FAIL | FAIL | PASS | jump 抑止 |
...

## 注意
- v3 ハーネスのバグで偽 FAIL になっていないか自己検証 (各 PASS が本当に PASS、各 FAIL が本当に FAIL)
- スクショは C:\tmp\sloten-pw-*-screenshots/ に
- 完了後、本セッション (Sloten メイン session) に結果を貼り付けて報告
```

---

## 推奨実行順序

### Stage 1 (並列実行可、外部依存少)
- **P-3** Golden Set (BK 依頼テンプレ含む) — 後続 P-4/P-5 のブロッカー解除
- **P-6** 管理画面 T4 修正 — 即効性あり、Reality Checker B3 解消
- **P-9** Playwright v3 完全再テスト — 現状の真の品質確定

### Stage 2 (Stage 1 後)
- **P-7** Soak Test スクリプト — 本番投入前の必須チェック
- **P-1** Session TTL 短縮 + revocation — セキュリティ強化
- **P-4** NON_MACHINE 反転 (pachi 側 commit 権限が必要)

### Stage 3 (Stage 1+2 後)
- **P-5** classifyIntent 統合 (P-3 必須)
- **P-2** SESSION_SIGNING_KEY 分離 (運用余裕がある時に)
- **P-8** Monitoring + Telegram Alert (本番投入直前)

### 外部依存 (BK チーム / Sloten CS チーム)
- **B2 Webhook 4 件設定** — BK 側で実 URL 発行待ち
- **P-3 Golden Set の tbd_bk_team 11 件** — CS チームが実顧客クエリ提供
