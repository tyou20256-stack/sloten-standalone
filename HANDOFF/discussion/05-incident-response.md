# Incident Response + Human Escalation 設計

**エージェント**: Incident Response Commander
**視点**: 障害対応、SLO、Runbook、On-call

---

## 1. Escalation ルール設計

### 強制 escalation (自動化不可、人間判断必須)

| ケース | trigger 条件 | escalation 先 | SLA | 自動化 fallback |
|---|---|---|---|---|
| 返金要求 | Chatwoot 会話に「返金」「返して」「取り消し」検出 | CS L2 | 15分 | bot 停止、「担当者確認中」表示 |
| 高額入金 | PayPay OCR 抽出額 >= 10,000円 | CS L1 承認後処理 | 30分 | 自動承認保留、status=`pending_human` |
| 連続 fail | 同一ユーザー OCR fail x3 or ボーナスコード error x5 以内 30分 | CS L1 | 30分 | 以降 1時間 bot 応答ブロック、「対応中」fallback |
| 法的キーワード | 「弁護士」「訴訟」「消費者センター」「警察」 | 経営者(KK) | 即時(push) | bot 完全停止、会話ロック |
| アカウント停止要請 | 「退会」「凍結」「アカウント削除」 | CS L2 | 1時間 | bot 応答は FAQ のみ、変更系は全て保留 |

### 閾値 escalation (信頼度次第)

| ケース | trigger | 動作 |
|---|---|---|
| OCR 信頼度 < 80% | Tesseract/Vision API confidence score | スプレッドシートに `needs_review` フラグ、CS L1 が目視確認。bot は「確認中(5-10分)」応答 |
| OCR 信頼度 80-95% | 同上 | 自動処理するが audit log に flag。事後 sampling review |
| FAQ 類似度 < 0.75 (embedding) | Chatwoot 着信メッセージ vs FAQ DB cosine similarity | bot 応答せず、CS L1 キューへ。「確認してご連絡します」自動送信 |
| sentiment 怒り > 0.7 | 簡易 sentiment (絵文字 + keyword "ふざけるな"等) | 即 CS L2 へ pin。bot 応答停止 |

### tempo escalation (時間経過)

| ケース | trigger | escalation |
|---|---|---|
| bot 無応答 | Chatwoot 会話が bot 割当後 3分間 message なし | CS L1 に auto-assign、Slack `#sloten-alerts` 通知 |
| 入金処理 stuck | `pending_human` が 20分以上 | CS L2 に escalate |
| 同一 state ループ | 同一会話で同 state 5回以上 | bot 離脱、CS L1 intervene |

### pattern escalation (異常検知)

| ケース | trigger | 動作 |
|---|---|---|
| 同一 IP 大量 | 同 IP から 10分以内に 5 会話開始 | Workers で rate limit、L2 に通知、疑義 flag |
| 深夜異常 | 02:00-06:00 JST に入金申請 >= 通常比 x3 | オンコール Eng へ Slack、bot は通常通り動作継続だが audit 強化 |
| ボーナスコード流出疑い | 同一コードが異なるユーザー 5件以上で使用 | コード即時無効化 (D1 `bonus_codes.active=0`)、CS L2 + Eng 両方通知 |

---

## 2. SLO 設計

| SLI | 現状 (推定) | 目標 | 測定窓 | エラーバジェット |
|---|---|---|---|---|
| 着金確認 p50 | 3分 | **2分** | 30日 | - |
| 着金確認 p95 | 15分 | **8分** | 30日 | 5% 超過許容 |
| 着金確認 p99 | 45分 | **20分** | 30日 | 1% |
| Bot 応答時間 p95 | 5秒 | **3秒** | 7日 | - |
| Escalation 率 | 推定 25% | **<15%** | 週次 | - |
| 誤処理率 (入金) | 推定 2% | **<0.5%** | 月次 | 月 2件まで |
| 誤処理率 (FAQ 誤回答) | 推定 5% | **<2%** | 月次 | - |
| Chatwoot 接続成功率 | 不明 | **99.5%** | 30日 | 月 3.6時間ダウン許容 |

**burn rate alert**:
- 着金 p95 が 1時間で 8分超過 6回 → ticket
- 着金 p99 が 30分で 20分超過 3回 → page (L2)

---

## 3. Runbook (起きそう順 Top 5)

### 事件1: PayPay OCR 誤読で誤着金計上

**検知**: 顧客から「入金額が違う」Chatwoot 問合せ、または日次 reconciliation (スプレッドシート総額 vs PayPay 実残高) 差分 > 100円

**一次対応 (CS L1、SLA 30分)**:
1. 対象会話の OCR 生画像をスプレッドシート `ocr_audit` シートから取得
2. 手動で正しい金額を確認
3. D1 `transactions` テーブルの該当 row を update (SQL は固定テンプレ、`scripts/fix_transaction.sql`)
4. 顧客へ定型文: 「確認が取れました。正しい金額 XX円で再計上しました」

**恒久対策**: OCR 信頼度 < 95% を全て `needs_review` に昇格 (閾値調整)、週次で誤読パターンを Vision API fine-tune 候補に蓄積

---

### 事件2: GAS → Chatwoot 送信が 10 件連続失敗

**検知**: Cloudflare Workers からの POST が 5xx 連続、`#sloten-alerts` に Slack webhook

**一次対応 (Eng オンコール、SLA 15分)**:
1. `curl -I https://script.google.com/macros/s/XXX/exec` で GAS 生存確認
2. Chatwoot 側: `curl https://chat.sloten.example/api/v2/accounts/1/conversations -H "api_access_token: XXX"` で 200 か確認
3. 切り分け:
   - GAS 5xx → GAS Apps Script Executions ログを確認、quota 超過なら待機
   - Chatwoot 5xx → VPS の docker container 状態 `docker ps`、`docker logs chatwoot-web --tail 200`
4. **暫定対策**: sloten-standalone の環境変数 `BONUS_CODE_WEBHOOK_ENABLED=false` を wrangler で set、bot は「現在お問合せ混雑中、5-10分お待ちください」fallback 返信
5. 復旧確認後、溜まった queue を GAS trigger 手動再実行 (`processBacklog()` 関数)

**恒久対策**: GAS → Workers 間に Cloudflare Queues を挟み、retry + dead letter 化

**顧客通知**: Chatwoot に bot メッセージ「システムメンテナンス中のため、ボーナスコード反映に遅延が発生しております。順次対応します」

**RCA 担当**: Eng (24時間以内に postmortem)

---

### 事件3: D1 接続不可 (Cloudflare 障害 or quota 超過)

**検知**: Workers の `D1_ERROR` が 1分で 50件超、Cloudflare Status Page 確認

**一次対応 (Eng、SLA 10分)**:
1. status.cloudflare.com 確認
2. Cloudflare 側の障害 → 待機 + 顧客通知のみ。**自動処理は全停止**、CS L1 が Chatwoot 手動運用に切替
3. 自社 quota 超過 → Cloudflare dashboard で確認、必要なら plan upgrade
4. 部分的フォールバック: Workers KV に読み取り専用 cache がある FAQ のみ継続応答

**恒久対策**: D1 を Durable Objects + KV の read-replica 構成に変更検討、または PostgreSQL (Neon) への段階移行

---

### 事件4: ボーナスコード大量流出 (SNS リーク)

**検知**: 同一コードが 10件/時 以上使用、pattern escalation 発火

**一次対応 (CS L2 + Eng、SLA 5分 page)**:
1. D1 で該当コード即時無効化: `UPDATE bonus_codes SET active=0, reason='suspected_leak' WHERE code='XXX'`
2. 過去 1時間の使用ログを export、正規顧客と流出分を分離
3. 正規顧客 (コード配布元と一致) はホワイトリスト化して再発行、不正分は rollback
4. Twitter/X 検索で流出元特定

**恒久対策**: コードを one-time-use + ユーザー ID 紐付けに変更、Workers で rate limit per IP

---

### 事件5: スプレッドシート書込不可 (Google API quota)

**検知**: GAS execution log で `ServiceException: Rate limit exceeded`

**一次対応 (CS L1、SLA 30分)**:
1. Google Workspace Admin で quota 確認
2. **暫定**: GAS 側で書込を一時 buffer (ScriptProperties)、10分後 batch flush
3. bot は継続稼働 (D1 が真実のソース、スプレッドシートは audit/BI 用途なら致命傷にならない)

**恒久対策**: スプレッドシート依存を BigQuery 日次 export に置換

---

## 4. On-call ローテーション設計

**階層**:
- **L1 (CS 担当)**: FAQ 応答、OCR 目視確認、定型返金処理。2名体制、営業時間 09:00-22:00 JST を 2 shift
- **L2 (CS リード)**: 高額案件、クレーム、退会処理。1名、営業時間 + 緊急時 on-call
- **L3 (Eng)**: システム障害、D1/Workers/GAS 修復。1名 primary + 1名 backup、週次ローテ

**境界**:
- Chatwoot からの escalation → 必ず L1 が最初に触る
- 「システムが動かない」系キーワード → L1 が即 L3 へ (判断しない)
- 金額・アカウント系 → L1 → L2 → L3

**通知**:
- **営業時間内**: Slack `#sloten-cs` (L1/L2)、`#sloten-eng` (L3)
- **営業時間外**: LINE 公式グループ (L1/L2 緊急のみ)、PagerDuty 相当は **Better Stack** (月 $25 で L3 の電話 escalation 可、PagerDuty より安価)
- **L3 page 条件**: SEV1 相当のみ (全停止、データ破損、法的)

**handoff**: 毎週月曜 10:00 JST、前週の incident 一覧を 15分引継ぎ (Notion で共有)

---

## 5. 顧客コミュニケーション自動化

**Incident 検知 → 顧客 UX**:

1. **混雑検知時 (escalation 率 > 25% / 10分)**: Chatwoot 自動 greeting に「現在お問合せが混雑しています。通常 2分のところ、5-10分お待ちいただく可能性があります」を 1時間差し込み
2. **個別 escalation**: bot が L1 に渡す瞬間「担当者に確認しています。3-5分お待ちください」自動送信 (3分後無応答なら再送「あと少々お待ちください」)
3. **SEV1 障害時**: sloten-standalone の全会話に system message broadcast「現在システムメンテナンス中です。復旧まで XX 時間を見込んでおります。ご不便おかけします」
4. **解決後 follow up**: 会話クローズ 30分後に CSAT 1-5 + 「解決しましたか？」自動送信。1点 or 2点は L2 へ自動 re-escalate

---

## 6. Audit trail

**記録項目** (D1 `audit_log` テーブル):
```
id, timestamp, conversation_id, user_id,
decision_type (ocr_approve / faq_answer / bonus_grant / escalate),
confidence_score, rule_id (どの rule 適用),
input_hash (SHA256), output,
human_override (bool), override_by, override_reason
```

**Human override の学習 pipeline**:
- CS が bot 判断を覆した全件 → 週次で `review_queue.csv` export
- FAQ 誤回答は FAQ DB に追加 (embedding 再計算)
- OCR 誤読は Vision API 再訓練候補

**Retention**:
- 決済関連 (入金・ボーナス): **7年** (所得税法 + 消費者契約法対応)
- FAQ/一般会話: **3年**
- OCR 画像: **1年** (PII 含むため期限後削除)
- 監査ログ本体: **10年** (将来の法的要求想定)
- R2 に immutable bucket (`object-lock` compliance mode) で保管

---

## 7. Chaos engineering (四半期実施)

### シナリオA: GAS 全停止
- **手順**: 土曜 14:00 に GAS Web App を `archive` に変更 (URL 無効化)
- **測定**: 検知まで何分？ fallback 動作？ 顧客からの不満 tickets 数？
- **合格基準**: 検知 5分以内、fallback メッセージが 100% 会話に出る、CS L1 が手動運用に 15分以内切替

### シナリオB: D1 接続不可
- **手順**: Workers 環境変数 `D1_BINDING` を別 DB に差替 (空 DB)
- **測定**: KV read-replica で FAQ がどの程度応答継続できるか、入金処理停止の検知時間
- **合格基準**: FAQ 80% 応答継続、入金は全件 `queued` で後処理可能、0件ロスト

### シナリオC: スプレッドシート書込不可
- **手順**: GAS スクリプトで該当シートの権限を一時剥奪
- **測定**: D1 が真実のソースとして機能し続けるか、BI ダッシュボードがどの程度壊れるか
- **合格基準**: ユーザー影響ゼロ、BI は最大 24時間遅延で復旧可

**演習後**: 必ず blameless postmortem (Notion テンプレ)、action item を Linear/Jira チケット化、次四半期までに 80% 完了を KPI 化。
