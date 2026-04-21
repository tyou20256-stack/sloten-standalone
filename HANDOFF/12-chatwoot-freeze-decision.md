# chatwoot-final-working 凍結判断ドキュメント

**決定日**: 2026-04-21
**決定者**: (担当承認後に記入)
**採用案**: **Option B — 凍結 (read-only / reference-only)**

---

## 背景

sloten-standalone は chatwoot-final-working の後継として設計された Cloudflare Workers + D1 ネイティブ実装。
2026-04-15 に sloten-standalone の並走開発が開始され、2026-04-20 までに全機能が移植完了 (`HANDOFF/11-migration-verification.md` 参照)。

本ドキュメントは、旧実装 `chatwoot-final-working` の今後の扱いを確定する。

---

## 3 案の比較

| 案 | 内容 | メリット | デメリット |
|----|------|----------|-----------|
| A: 継続保守 | 両方を並行更新 | 既存環境の運用継続可 | **二重開発コスト、スキーマ乖離リスク、バグ修正の二重適用必須** |
| **B: 凍結 (採用)** | read-only 化、参照用に保持 | 資料価値保持、二重開発解消、差分追跡不要 | Chatwoot 固有機能を使い続ける場合は個別判断 |
| C: 削除 | リポジトリごと削除 | クリーンな状態 | 過去の実装ロジック・メッセージ文言の参照不可、復元コスト大 |

---

## Option B 採用の根拠

### 1. 移植完了の証明
- `HANDOFF/11-migration-verification.md` にてファイル単位で検証済み
- 残タスク 3 件 (heavenday_daachin、flow seed 5日差分、凍結判断) は **本日 (2026-04-21) すべて完了**
  - heavenday_daachin → seed 追加済み (`seeds/_bonus-success-raw.json` + `scripts/seed-bonus-codes.mjs`)
  - flow seed 再生成 → 104 → 109 steps (+5)、treasure_day1-3 / heavenday_daachin / honey4w を取込済
  - 凍結判断 → 本ドキュメント

### 2. 二重開発コスト回避
- 両方を並行更新すると、同じバグ修正・機能追加を 2 箇所に適用する必要がある
- sloten-standalone は 4 パスのセキュリティレビューを経ており、旧実装は同水準ではない

### 3. 参照価値の維持
- messages.js の flow 定義・bonus-code 定義は依然として "production-truth" のマスターデータ
- sloten-standalone の seed 再生成時に **messages.js を source of truth として参照** する運用が既に確立済み (`scripts/convert-agentbot-messages.mjs`)
- したがって、削除 (Option C) ではなく **read-only 保持** が適切

---

## 凍結の具体的アクション

### 即時実行 (デプロイ後)

- [ ] **README.md 最上部に凍結通知を追加** (担当者が実施)
  ```markdown
  > ⚠️ **このリポジトリは 2026-04-21 に凍結されました。**
  > 後継実装は [sloten-standalone](../sloten-standalone/) を参照してください。
  > バグ修正・機能追加は sloten-standalone 側のみで行います。
  ```

- [ ] **GitHub リポジトリを Archive 化** (GitHub リポがある場合)
  - `Settings → General → Danger Zone → Archive this repository`
  - Archive 化すると push / PR / issue が自動的に read-only

### 継続運用

- **messages.js は source of truth として維持**
  - sloten-standalone の `scripts/convert-agentbot-messages.mjs` が読込対象として参照
  - messages.js への変更は **sloten-standalone 開発チーム経由のみ**許可
  - 単独での編集は禁止 (混乱の原因)

- **bonus-codes.js / bonus-codes-api.js も read-only**
  - 新規ボーナスコード追加時は **sloten-standalone 側に seed 追加**
  - 必要であれば messages.js 側にも success message を同期

- **worker.js / worker-with-ai.js は更新禁止**
  - 本番環境 (Chatwoot AgentBot) では既に stop 済 (またはまもなく停止予定)
  - コード変更は sloten-standalone 側のみ

### 凍結解除条件

以下のいずれかの状況で凍結解除を検討 (確率: 低):
1. sloten-standalone の Cloudflare Workers 停止 / アーキテクチャ変更
2. Chatwoot への差し戻しが必要な業務要件変更
3. messages.js の大規模リファクタリング (source of truth 移管)

---

## 凍結後の依存関係図

```
┌──────────────────────────────────────┐
│ chatwoot-final-working/              │
│   (FROZEN, read-only, reference)     │
│                                       │
│   ├── messages.js ────┐               │
│   ├── bonus-codes.js  │  source       │
│   ├── bonus-codes-api │  of truth     │
│   ├── worker.js       │               │
│   └── admin.js (...)  │               │
└───────────────────────┼──────────────┘
                        │
                        │ (scripts/convert-agentbot-messages.mjs が読込)
                        │
                        ↓
┌──────────────────────────────────────┐
│ sloten-standalone/ (ACTIVE)          │
│                                       │
│   ├── seeds/seed-flow-sloten-main.sql (自動生成) │
│   ├── seeds/_bonus-success-raw.json              │
│   ├── scripts/seed-bonus-codes.mjs               │
│   └── src/*.mjs (Cloudflare Workers impl)        │
└──────────────────────────────────────┘
```

---

## 未解決事項 (凍結時に残る課題)

| 項目 | 方針 |
|------|------|
| Chatwoot AgentBot 本番の停止タイミング | **デプロイ後 1 週間様子見 → Chatwoot 側 AgentBot を停止** (並行運用しない) |
| Chatwoot UI (スタッフ operator interface) | sloten-standalone の operator UI へ完全移行済 |
| `C:/tmp/backup-*.sql` の扱い | sloten-standalone の D1 backup に一本化 |
| 過去ログ (Chatwoot conversations) | **Chatwoot サーバーが稼働している間は参照可能**、停止後は backup から復元 |

---

## 判断記録 (承認欄)

```
□ Option B (凍結) を採用する
□ Option A (継続保守) を採用する  ← 推奨しない
□ Option C (削除) を採用する       ← 推奨しない
```

**承認者**: _________________
**承認日**: _________________
**実行責任者**: _________________

---

## 関連ドキュメント

- `HANDOFF/11-migration-verification.md` — 移植検証結果 (本判断の根拠データ)
- `HANDOFF/02-deploy-runbook.md` — 本番デプロイ手順
- `HANDOFF/README.md` — 引継ぎ全体のエントリポイント
