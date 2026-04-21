# Automation Governance 評価

**エージェント**: Automation Governance Architect
**視点**: 自動化境界、ガバナンス、Tier 設計

---

## 1. What CAN be automated (手放せる)

### 完全自動化候補 (Tier 3 目標)

- **FAQ candidate 抽出 → KB 自動投入 (条件付き)**: 同一質問 N 件以上 + AI 回答 confidence > 0.9 + 類似 KB 未存在 → 下書き自動生成まで。`sloten-standalone` 内で閉じる。
- **ボーナスコード申請の受理・照合・記録**: コード文字列 → 有効期限/使用済みチェック → スプレッドシート追記。v9.4 generic handler がある以上、**付与実行まで** 自動化可能 (ゲーム側 API があれば)。
- **PayPay 取引番号の一次照合**: 取引番号 format 検証 + 重複検知 + 金額 format チェック。現状 staff がやっている「明らかにダメなやつ」を弾く層。
- **エスカレーション tagging/routing**: 感情分析 (怒り/返金/法的言及) → 優先度付けと担当者振り分け。判断ではなく **通知の整流化**。
- **システム監視・障害一次対応**: Workers/D1 の error rate, p95 latency, queue depth → 閾値超で自動 restart 試行 + Slack 通知。
- **新イベント rollout の定型部分**: spreadsheet タブ生成、admin UI の event 登録、GAS 側 config 追加 (generic handler 済)。

## 2. What MUST stay human (残すべき)

- **最終的な着金確定 → アカウント反映の approve**: PayPay スクショ偽造、チャージバック、マネロン疑いがあり得る。OCR + API 照合で 99% 合致しても、**反映ボタンを押すのは人間** を初期は維持。
- **返金・出金停止・アカウント凍結**: 金銭的不可逆 + 法的責任。gambling/slot 文脈は特に reputational risk が高い。
- **依存症・自傷示唆・未成年疑いの応対**: AI が「大丈夫ですよ」と返したら事業存続に関わる。
- **クレーム・訴訟示唆・景品表示法抵触疑い**: 回答一つが証拠になる。
- **ボーナスコードのルール新設・変更承認**: 景品規約に関わる。AI 下書きは OK だが公開承認は人間。
- **個別の裁量特典 (お詫び bonus 等)**: 金額決定は属人的で、AI に任せると相場が崩壊する。

## 3. What SHOULD be HYBRID (AI 下案 + 人間 1-click)

- **着金確認**: OCR でスクショから ID/金額/時刻を抽出 → PayPay API (or CSV import) と照合 → 一致なら緑、乖離なら赤でスプレッドシートに表示。staff は緑を一括チェックして "反映 TRUE"。これで 1 件 30 秒 → 3 秒。
- **ボーナスコード処理**: AI が「コード X は event Y の規約上 条件 A を満たすため N 円相当の特典付与が妥当」と下案提示 → staff が approve。
- **FAQ / KB 追加**: AI が候補 + 下書き + 類似既存 KB との diff を提示 → 週次 review で一括 approve。
- **エスカレーション一次応答**: AI 下書き → staff が "送信" / "修正して送信" / "自分で書く" の 3 択。
- **新イベント rollout**: AI が過去イベントから config 生成 → 人間が diff review → apply。

## 4. Governance フレームワーク (Tier ゲート)

- **Tier 0 (Shadow, 2-4 週)**: AI が判断ログを出力するだけ。staff 判断と突合し **agreement rate** を測定。着金確認で 98% 一致、ボーナスコードで 95% 一致が目安。
- **Tier 1 (Low-risk auto)**: 着金確認なら **3,000 円以下 + 取引番号一致 + 既存ユーザー (履歴 N 回以上)** のみ自動反映。FAQ なら confidence > 0.95 + 類似 KB なし。
- **Tier 2 (Conditional auto)**: Tier 1 実績で誤判定率 < 0.1% を 30 日維持したら、閾値を 10,000 円 / 新規ユーザー解禁へ拡張。reputation score 導入。
- **Tier 3 (Full auto + audit)**: 全額自動化。ただし **日次 sampling audit** (5%) を人間が後追い確認。anomaly detection で乖離検知したら即 Tier 2 にロールバック。

各 Tier 移行には **SLO (誤判定率、顧客クレーム率、反映遅延)** と **ロールバック条件** を事前定義。

## 5. 見落としがちな落とし穴 (このシステム特有)

- **「自動化した結果さらに手作業が増える」**: OCR 誤認識の手動訂正が着金確認より重くなるパターン。→ **OCR confidence 低いものは従来フローにそのまま流す** 設計が必須。二段化するな。
- **GAS / Workers / spreadsheet の 3 層分散**: 障害時に「どこで止まったか」が不明瞭。`gas-paypay-bot-v3.0.2.js` が落ちたら widget 側は成功表示のまま。→ **end-to-end の correlation ID** と **spreadsheet 側 heartbeat 行** を追加。
- **"反映 TRUE" の取り消し経路がない**: 自動化後に誤反映が発生した場合、現状 staff の経験則で逆仕訳してるはず。→ **reversal workflow を先に作る**。これなしに自動化は着手禁止。
- **AI が「返金します」と口走る事故**: Gemini が文脈を誤読して約束する。→ 金銭・特典に関するキーワード (返金/補償/追加ボーナス) は **必ず人間 gate** に送るフィルタを Tier 0 から常設。
- **スプレッドシートが source of truth のまま自動化**: 行数 10 万超えたら崩壊する。→ 自動化着手と同時に **D1 への正規化移行** を計画。
- **overnight 修正 45 件直後の安定性未証明**: 自動化の土台として信頼性データが足りない。最低 2 週の本番観測が先。

## 6. 優先順位 Top 3

| # | 項目 | 工数 | 便益 | リスク | 総合 |
|---|---|---|---|---|---|
| **1** | **着金確認ハイブリッド (OCR + API 照合 + 1-click approve)** | 4 | 5 | 2 | 着手最優先。日次件数最多 + Tier 0 の shadow log が取りやすい + reversal 経路を設計すれば risk 低。staff 工数 70% 削減見込み。 |
| **2** | **エスカレーション tagging / 下書き生成** | 2 | 4 | 1 | 送信は人間のままなので risk 極低。sloten-standalone 内で完結。怒り検知で事故率も下がる副次効果あり。 |
| **3** | **FAQ candidate 下書き自動化 + 週次 1-click approve** | 2 | 3 | 1 | 既存の週次 review workflow を拡張するだけ。KB が育つと AI 応答精度が上がる複利効果。ボーナスコード自動化はここが整ってから。 |

**除外理由**: ボーナスコード付与自動化は便益高いが、ゲーム側 API の有無が不明 + 景表法 risk で Top 3 外。着金確認 Tier 2 到達後に着手すべき。

**Verdict: APPROVE AS PILOT** — 上記 #1 を Tier 0 shadow mode から 2 週間、SLO 達成を確認後に Tier 1 へ段階移行。reversal workflow と correlation ID を前提条件とする。
