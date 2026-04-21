# 自動化戦略 — 6 専門家議論の統合レポート

**議論日**: 2026-04-20
**目標**: スロット天国カスタマーサポートを **「極力人の手を使わない」** 運用へ
**形式**: 6 専門エージェント並列 analysis + 統合

---

## 📋 アサインした 6 専門エージェント

| # | エージェント | 視点 | Report |
|---|------------|------|--------|
| 1 | Automation Governance Architect | 自動化境界、ガバナンス、Tier 設計 | [01-governance.md](01-governance.md) |
| 2 | AI Engineer | OCR/NLP/異常検知の技術選定 | [02-ai-ml.md](02-ai-ml.md) |
| 3 | Workflow Optimizer | 現行タッチポイント棚卸し + ROI | [03-workflow.md](03-workflow.md) |
| 4 | AI Data Remediation Engineer | Self-healing / 自動復旧 | [04-self-healing.md](04-self-healing.md) |
| 5 | Incident Response Commander | 障害対応、SLO、Runbook | [05-incident-response.md](05-incident-response.md) |
| 6 | Support Responder | 顧客体験境界、CX KPI | [06-cx.md](06-cx.md) |

---

## 🎯 全員合意した 5 点

1. **OCR 着金確認自動化が圧倒的 ROI** — 月 ¥150k-565k 削減 vs コスト月 $1.5
2. **クレーム・法的・高額・依存症兆候は絶対 human** — カジノ業態での reputation risk は致命的
3. **自動化の前に observability + reversal workflow の整備が必須**
4. **スプレッドシート運用は負債、中期的に D1 + admin UI へ移行**
5. **"人を呼ぶボタン"は常設派 + 1 クッション設計**

---

## ⚔️ 対立点と統合判断

| 論点 | Governance 派 | Support 派 | 統合判断 |
|------|-------------|----------|---------|
| 最終到達点 | Tier 3 フル自動化 | bot 60-70% 死守 | **領域別棲み分け**: 定型フロー (着金確認、FAQ) は Tier 3 可、顧客対応 (クレーム、escalate) は Tier 2 上限 |
| 人間ボタン | 条件付き表示 | 常設必須 | **常設 + 1 クッション** (「担当者に繋ぐ前にこちらで解決できるかも」で 40% bot 解決、60% 高優先キューへ) |
| SLO | 技術指標中心 | CSAT / NPS 中心 | **両方併記** — 技術 KPI だけだと顧客体験劣化を見逃す |

---

## 💰 ROI 順位 (全員 consensus)

| 順位 | 項目 | 工数 | 月間削減 | 月コスト | Risk |
|------|------|------|---------|---------|------|
| 🥇 1 | 着金確認 OCR ハイブリッド | 8 人日 | ¥150k | $2 | 中 |
| 🥈 2 | エスカレーション tagging + AI 下書き | 4 人日 | ¥40k + 炎上回避 | $2 | 低 |
| 🥉 3 | FAQ 自動抽出 + 下書き | 10 人日 | ¥20k (複利大) | $5 | 低 |
| 4 | 異常検知 (ルール + pHash + LLM) | 6 人日 | fraud 回避 | $1 | 中 |
| 5 | インテント分類 embedding cache | 4 人日 | ¥40k | $2 | 低 |
| 6 | スプレッドシート → D1 移行 | 6-8 週 | 構造改善 | 中 | 高 |

---

## 🗓 3-Phase ロードマップ

### Phase 0: 自動化の土台 (2-4 週、先行必須)

**これなしに自動化着手は危険** (全員合意)。

- [ ] `events_log` テーブル + GAS Logger wrapper (3 人日)
- [ ] `correlation_id` を全 flow に貫通 (2 人日)
- [ ] Reversal workflow (誤処理復元 SQL templates) (2 人日)
- [ ] Kill switch (`automation_enabled` KV flag) (1 人日)
- [ ] 日次 reconciliation job (D1↔シート diff) (3 人日)
- [ ] Canary heartbeat (5 分毎合成テスト) (2 人日)
- [ ] SLO ダッシュボード (技術+CSAT 併記) (3 人日)

**計 16 人日 ≒ 3-4 週間**

### Phase 1: Quick Wins (1-2 ヶ月)

最優先 3 件:

1. **着金確認 OCR ハイブリッド** — Gemini 2.5 Flash Vision, Tier 0 shadow → Tier 1 (3kまで) → Tier 2 (10kまで)
2. **エスカレーション tagging + AI 下書き** — sentiment 検知 + 返信下書き (必ず送信前に人間 gate)
3. **FAQ 自動抽出 upgrade** — keyword clustering → embedding clustering + AI 下書き

**期待削減**: 月 314 h (¥565k 相当)

### Phase 2: 主要自動化 (2-4 ヶ月)

- 異常検知 (Workers ルール + pHash + LLM 分類 2 層)
- スプレッドシート API 化 (案 A: 短期延命)
- インテント分類 embedding cache (L1 cache + L2 LLM)
- ボーナスコード付与自動化 (ゲーム側 API 前提)

**期待削減累計**: 月 494 h (¥890k 相当)

### Phase 3: 抜本改善 (4-6 ヶ月)

- スプレッドシート → D1 + Workers admin UI 完全移行 (案 B)
- 予測 alert (7 日移動平均 + 3σ)
- Chaos engineering 年次化 (GAS 停止、D1 不可、シート不可 シナリオ演習)

**期待削減累計**: 月 614 h (¥1.1M 相当)

**3 Phase 合計投資**: ¥2.5-4M、**6 ヶ月で回収、年間 ¥13M+ 削減効果**

---

## 🚦 ガバナンス原則 (厳守)

### "絶対人間" カテゴリ (Tier 3 でも自動化しない)

| カテゴリ | 判定 trigger |
|---------|-------------|
| 返金・出金停止・凍結 | 金銭的不可逆 |
| 大額 (> 10k 入金 / > 50k 出金) | 被害額閾値 |
| 法的言及 | 「弁護士」「訴訟」「消費者センター」「警察」 |
| 依存症兆候 | 「死にたい」「やめたい」「助けて」 |
| 未成年疑い | 年齢関連言及 |
| クレーム / 怒り sentiment > 0.7 | キーワード + 全角大文字 + 感嘆符連続 |

### 自動化側の必須前提

1. Reversal workflow 存在 (誤処理の復元 SQL が事前用意)
2. Correlation ID で end-to-end 追跡
3. Kill switch 1 コマンド全停止
4. 金額 5,000 円以下のみ auto rollback 許可
5. 連続失敗 10 件で circuit open → human escalation

---

## 📊 SLO (技術+顧客体験 併記)

| 指標 | 現状推定 | 3 ヶ月 | 6 ヶ月 |
|------|---------|--------|--------|
| **技術** | | | |
| 着金反映 p50 | 45 分 | 8 分 | 2 分 |
| 着金反映 p95 | 2 時間 | 20 分 | 8 分 |
| 自動処理率 | 10% | 65% | 88% |
| 誤処理率 | 1.2% | 0.4% | 0.1% |
| **顧客体験** | | | |
| CSAT (5段階) | 3.4 | 4.1 | 4.5 |
| 再問い合わせ率 | 不明 | <15% | <10% |
| Escalation 率 | 25% | 15% | 10% |
| 離脱率 | 不明 | <15% | <10% |

---

## 👥 最小人員配置

**営業時間 (10:00-25:00)**:
- L1 triage (junior): **2-3 人**
- L2 complex (mid-senior): **1-2 人**
- L3 escalation owner (senior): **1 人**

**夜間 (25:00-10:00)**:
- senior **1 人 on-call**

**計 4-6 人 + 夜間 1**

これ以下は顧客体験崩壊リスク。

---

## 🎬 最初の 1 週間で着手

### Week 1

1. **events_log テーブル + GAS Logger wrapper 実装** (3 人日)
   - D1 schema + Workers ingestion endpoint + GAS 側 logger 関数
   - すべての後段判断の素材になるため最優先

2. **PayPay スクショ 30 件を Gemini Vision shadow test** (1 人日)
   - Tier 0 実装前の feasibility 確認
   - 抽出精度、信頼度分布、誤読パターンを measure

3. **Reversal SQL templates** (2 人日)
   - `scripts/fix_deposit.sql`, `scripts/fix_bonus.sql`, `scripts/fix_faq_promote.sql`
   - 誤処理を安全に戻せる手順を明文化

---

## 📂 関連ドキュメント

- 本 synthesis: `HANDOFF/discussion/00-synthesis.md` (このファイル)
- 各専門家 report: `HANDOFF/discussion/01-06`
- 既存の HANDOFF (overnight 作業): `HANDOFF/README.md` および `01-09`
