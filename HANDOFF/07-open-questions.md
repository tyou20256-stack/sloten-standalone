# 07. 引き継ぎ担当が判断する項目

**所要**: 各 2-3 分、計 10 分で全判断完了。
デプロイ前に全部決めておくこと。

---

> **⚠️ GAS 連携を使っているプロジェクトは `08-gas-urls.md` も必ず目を通すこと。**
> Q1 の判断は現在保存されている GAS URL との整合性に直結する。

## Q1. `ALLOWED_WEBHOOK_HOSTS` を設定するか

### 何が起きるか

管理画面で保存できる webhook URL を **exact host match** で制限。
設定すれば社内の正式な GAS / sloten.io 以外の URL は admin すら保存不可。

### 選択肢

| 選択 | 挙動 | 推奨度 |
|------|------|-------|
| **設定する** (推奨) | exact host allowlist で二重防御 | ★★★ |
| 設定しない | 一般的な SSRF ガード (private IP 拒否) のみ | ★★ |

### 推奨値

```bash
wrangler secret put ALLOWED_WEBHOOK_HOSTS
# 値: script.google.com,sloten.io
```

現行で使っている GAS のドメインを確認してから決定。
`script.google.com` は Google Apps Script のエンドポイント。

### 確認方法

現在設定されている webhook URL を D1 から確認:
```bash
wrangler d1 execute sloten_standalone_db --remote \
  --command="SELECT key, value FROM env_overrides;"
```

### **あなたの判断**: [ 設定する / 設定しない ]

---

## Q2. `ADMIN_ORIGINS` を設定するか

### 何が起きるか

admin 状態変更 API (POST/PUT/DELETE on `/api/admin/*`, `/api/staff`, `/api/faq` 等) の CSRF Origin チェックが厳格化。
**デフォルト = `sloten-admin-secure.pages.dev` のみ許可**。他の origin から POST すると 403。

### 選択肢

| 選択 | 挙動 | 使う場合 |
|------|------|----------|
| **設定しない** (デフォルト) | `sloten-admin-secure.pages.dev` のみ管理 | 管理画面の URL が上記と一致する |
| 設定する | 追加の exact origin も管理 OK に | 社内で別 URL も使っている |

### 推奨値の例

```bash
wrangler secret put ADMIN_ORIGINS
# 値: https://sloten-admin-secure.pages.dev,https://admin.internal.example.com
```

### 確認方法

現在管理画面を開く時の URL (ブラウザ上の origin) を確認。
`https://sloten-admin-secure.pages.dev` なら **設定不要**。

### **あなたの判断**: [ 設定不要 / 追加する (値: ______) ]

---

## Q3. `ab1d04f wip: pre-overnight snapshot` をどう扱うか

### 何が起きるか

`main` には `ab1d04f wip: pre-overnight snapshot (admin.js split + filter improvements)` が既に乗っている。
これは overnight 作業開始前に未コミットだった変更 (admin.js 分割 + filter 改善) を保全した commit。

### 選択肢

| 選択 | 挙動 | 推奨度 |
|------|------|-------|
| **そのまま残す** (推奨) | 履歴が明確。overnight の merge commit と合わせて作業の塊が見える | ★★★ |
| Squash して 1 commit にまとめる | `git rebase -i` で整形。履歴簡潔だが作業量あり | ★ |
| amend して通常メッセージに | `main` の直近 force push 必要。他者の push 影響あれば要調整 | ★ |

### 推奨

**そのまま残す**。wip で始まるのがダサいなら amend で通常メッセージに書き換え (force push 可能なら)。

### **あなたの判断**: [ そのまま / amend / squash ]

---

## Q4. デプロイ時間帯

### 何が起きるか

ダウンタイムは理論ゼロだが、直後の手動 smoke (15 分) 中にトラブルが出る可能性。
問題発生時の対応余裕を確保したい。

### 選択肢

| 時間帯 | メリット | デメリット |
|--------|---------|-----------|
| **平日日中 (10:00-16:00)** | サポート人員が揃う | 顧客トラフィック最大 |
| 平日夜 (20:00-22:00) | 顧客トラフィック低 | サポート人員少 |
| 週末朝 (土曜 10:00-12:00) | トラフィック最低、人員もいる | 休日出勤 |

### 推奨

**平日 10:00-12:00** (午前中なら問題出ても午後に修正できる)。

### **あなたの判断**: [ 日時: _______ ]

---

## Q5. ロールバック判断基準

### 何が起きるか

デプロイ後、どのメトリクス / エラーが出たら即 rollback するかを事前決定。

### 推奨基準 (下記のいずれかが満たされたら即 rollback)

| 指標 | 閾値 | 理由 |
|------|------|------|
| 5xx エラー率 | > 5% が 5 分継続 | code 異常 |
| 4xx (401/403) 急増 | 通常比 +100% | CSRF / tenant scope で弾かれすぎ |
| Worker invocation 急減 | 通常比 -50% | routing 壊れ |
| Widget 接続 drop | 通常比 +50% | contact_token 処理の問題 |
| 手動 smoke test 失敗 | 1 項目でも | コードの本質的な問題 |

### Rollback 手順

`02-deploy-runbook.md` §10 を参照。要約:

```bash
# Workers rollback (1 分以内で完了)
wrangler rollback --name sloten-standalone

# 必要なら migration も戻す (通常不要)
# 016/017 は追加のみなので old code でも動く
```

### **あなたの判断**: [ 上記基準を採用 / カスタム基準: _______ ]

---

## Q6. (任意) SVG 運用の周知が必要か

### 何が起きるか

本ブランチを deploy すると SVG アップロードが不可に。
通常 PNG/JPG で運用しているはずだが、SVG を積極的に使っていた場合はユーザーに周知。

### 選択肢

| 選択 | 挙動 |
|------|------|
| **周知不要** (推奨、SVG 使っていない場合) | そのままデプロイ |
| 周知する | widget / operator / admin ユーザーに PNG 推奨を伝える |

### 確認方法

```bash
# 本番 attachments テーブルで SVG の使用履歴を確認
wrangler d1 execute sloten_standalone_db --remote \
  --command="SELECT COUNT(*) n FROM attachments WHERE content_type LIKE '%svg%';"
# n=0 なら周知不要
```

### **あなたの判断**: [ 周知不要 / 周知する ]

---

## Q7B. GAS generic handler の適用 — **コードは実装済み (v9.4)**

### 現状

**GAS v9.4 のコードはすでに作成済み**:
📁 `c:/Users/PC/OneDrive/Desktop/chatwoot-final-working/chatwoot-final-working/gas-bonus-code-v9.4.js`

ただし GAS は Google 側でホストされているため、**Google Apps Script Editor での手動デプロイ作業が必要**。
詳細な適用手順: [`09-gas-v94-deploy.md`](09-gas-v94-deploy.md) を参照 (30 分の作業)。

### 選択肢

| 選択 | 挙動 |
|------|------|
| **今回適用する** (推奨) | `09-gas-v94-deploy.md` に従い 30 分で GAS 適用 + URL 切替 |
| sloten-standalone デプロイ後、別日に適用 | 安全策。sloten-standalone の安定確認後に別作業として実施 |
| 適用しない | 新 event 追加のたびに引き続き手動 6 ステップ |

### 推奨フロー

```
Day 1: sloten-standalone を main merge + デプロイ (overnight の成果)
         ↓
     24h モニタリング
         ↓
Day 2 以降: GAS v9.4 を適用 (Day 1 の安定性確認後)
```

sloten-standalone と GAS の変更を同時に入れると、問題発生時の原因切り分けが難しくなるため、**分離推奨**。

### 工数と注意点

- 既存 20+ イベントの挙動に変化なし (既存 `case` 分岐は全て残る、default だけ改良)
- 新しい event は 4列共通フォーマット前提 (A申請日時 / B ユーザーID / C ボーナスコード / D ステータス)
- 特殊な列構成 (ひな祭りのコード列なし等) は今後も個別 `case` を追加する必要あり
- GAS 新デプロイで URL が変わるため、sloten-standalone 側で `BONUS_CODE_WEBHOOK_URL` の切替作業もセット
- ロールバックは sloten-standalone 側で URL を旧値に戻すだけ (30 秒)

### **あなたの判断**: [ Day 1 同時適用 / Day 2 以降別日 / 適用しない ]

### 何が起きるか (未実施)

Review 3 で FIN-011 として指摘された項目。cookie 名を `sloten_staff_session` → `__Host-sloten_staff_session` にすると subdomain cookie shadowing 攻撃に強くなる。

**ただし適用すると既存セッション全員が無効化**。

### 選択肢

| 選択 | 挙動 |
|------|------|
| **今回は適用しない** (推奨) | 本ブランチは変更なし。後日 opt-in の deploy で対応 |
| 今回適用 | 既存ログインスタッフ全員が再ログイン必要 |

### **あなたの判断**: [ 後日 / 今回 ]

---

## 記入欄 (引き継ぎ担当用)

```
担当者名: ___________________
判断日付: ___________________

Q1. ALLOWED_WEBHOOK_HOSTS:  □ 設定する (値: _______________)  □ 設定しない
Q2. ADMIN_ORIGINS:          □ 設定不要  □ 追加 (値: _______________)
Q3. wip commit:             □ そのまま  □ amend  □ squash
Q4. デプロイ日時:           _______________ (JST)
Q5. ロールバック基準:       □ 推奨採用  □ カスタム (メモ: _________)
Q6. SVG 周知:               □ 不要  □ 実施
Q7. __Host- prefix:         □ 後日  □ 今回
Q7B. GAS generic handler:   □ 今回追加  □ 後日  □ しない
```

---

## 判断が終わったら

`02-deploy-runbook.md` §1 から順に実行してください。
