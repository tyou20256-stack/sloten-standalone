# INDEX — 引き継ぎ資料ツリー

ここが迷子になった時に戻る場所。`HANDOFF/` 直下の全ファイルの役割と参照順。

---

## ディレクトリ構造

```
sloten-standalone/HANDOFF/
│
├── README.md                      ★★★ 最初に読む (5分)
├── INDEX.md                       🧭 本ファイル (迷ったら戻る)
│
├── 01-status.md                   ★★★ 現状 (ブランチ・テスト・本番)
├── 02-deploy-runbook.md           ★★★ デプロイ手順書 (作業時)
├── 03-production-readiness.md     ★★  検証結果レポート
├── 04-breaking-changes.md         ★★★ API 挙動変更 (要周知)
├── 05-files-changed.md            ★   変更ファイル詳細 (参照用)
├── 06-commit-list.md              ★   26 commits 詳細 (参照用)
├── 07-open-questions.md           ★★★ 判断項目 7 件 (デプロイ前必読)
├── 08-gas-urls.md                 ★★★ GAS webhook URL 運用手順 (GAS 連携必読)
├── 09-gas-v94-deploy.md           ★★★ GAS v9.4 (Generic Handler) 適用手順
├── 11-migration-verification.md   ★★★ chatwoot → sloten 移植検証結果
├── 12-chatwoot-freeze-decision.md ★★★ chatwoot 凍結判断 (Option B 採用)
├── 13-hybrid-dependency-map.md    ★★★ sloten ↔ GAS 責任分担マップ
├── 14-gas-update-sop.md           ★★★ PayPay/EC GAS 更新 SOP
│
├── discussion/                    ★★★ 自動化戦略 (6 専門家議論)
│   ├── 00-synthesis.md            統合ロードマップ + 合意/対立まとめ
│   ├── 01-governance.md           自動化境界 / Tier 設計
│   ├── 02-ai-ml.md                OCR/NLP/異常検知 技術選定
│   ├── 03-workflow.md             人的タッチポイント棚卸し + ROI
│   ├── 04-self-healing.md         Self-healing / 自動復旧
│   ├── 05-incident-response.md    障害対応 / SLO / Runbook
│   └── 06-cx.md                   顧客体験境界 / CX KPI
│
└── review-reports/                ★   レビュー詳細 (深掘り時のみ)
    ├── overnight-summary.md       総括 (morning report コピー)
    ├── morning-report.md          同上 (worktree 内オリジナル)
    ├── pass1-code-qa.md           Pass 1: コード QA (25 findings)
    ├── pass1-performance.md       Pass 1: Performance (20 findings)
    ├── pass2-regression-gap.md    Pass 2: Tenant gap + regression (18 findings)
    ├── pass4-security-audit.md    Pass 4: Auth/Webhook/DO 監査 (25 findings)
    └── all-issues-pass1.md        Pass 1 の統合 issue リスト
```

---

## 用途別ナビゲーション

### 🎯 「まず何をすればいい？」

```
README.md
  ↓
01-status.md で現状把握
  ↓
07-open-questions.md で 7 項目を判断
  ↓
02-deploy-runbook.md に従って作業
```

### 🔍 「この変更の詳細を知りたい」

```
06-commit-list.md で該当 commit を特定
  ↓
git show <commit-sha> で diff 確認
  ↓
05-files-changed.md でファイル単位の変更サマリ
  ↓
review-reports/ で Finding の元ネタ
```

### 🚨 「デプロイでトラブルが出た」

```
02-deploy-runbook.md §10 (ロールバック) ← 即参照
  ↓
03-production-readiness.md で「未検証項目」確認
  ↓
04-breaking-changes.md で影響予測
```

### 📣 「運用チームに周知したい」

```
04-breaking-changes.md をコピー/要約
  ↓
§B1-B13 を該当項目だけピックアップ
  ↓
末尾の周知メモ (コピペ用) を使用
```

### 🤔 「なぜこの修正が必要だった？」

```
review-reports/pass1-code-qa.md      初回 QA
review-reports/pass1-performance.md  パフォーマンス
review-reports/pass2-regression-gap.md  tenant gap + regression
review-reports/pass4-security-audit.md  security 最終監査
```
それぞれに Finding 単位で "Risk" と "Evidence" 欄あり。

---

## 所要時間の目安

| 作業 | 時間 |
|------|------|
| 引き継ぎ資料を読む (全体像把握) | 15-20 分 |
| `07-open-questions.md` の判断 | 10 分 |
| ローカルで `npm test` + `npm run dev` + smoke | 15 分 |
| 本番デプロイ手順実行 | 30-45 分 |
| デプロイ後 smoke (手動) | 15 分 |
| 24h モニタリング | 観察のみ |

**合計**: 初日 1.5-2 時間で deploy 完了、24h 様子見。

---

## 困ったら

- このフォルダに戻って `README.md` を読み返す
- worktree は `../sloten-standalone-overnight-2026-04-17-2311/` に残っている (消して良い)
- git 操作は全て `main` か `chore/overnight-2026-04-17-2311` ブランチを対象にする
- 本番に不可逆な変更 (secret delete, migration 手書き実行) は**絶対にしない**
