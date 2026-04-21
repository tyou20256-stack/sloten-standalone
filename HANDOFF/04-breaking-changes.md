# 04. Breaking Changes (API 挙動変更一覧)

本ブランチを main に merge + deploy すると、以下の API 挙動が変化する。
**デプロイ前に運用チーム・フロントエンド担当に必ず共有すること**。

---

## 🔴 即座に影響する変更 (Deploy 時点で発動)

### B1. `/api/bonus-code-submissions` が **admin ロール必須** に

- Before: `requireStaff` (任意の認証済みスタッフ可)
- After: `requireAdminRole` (admin ロールのみ)
- **非 admin スタッフは 403**

**対応**: このエンドポイントを使っている運用スタッフに admin ロールを付与、または運用を admin に集約。

### B2. `/api/admin/*` 状態変更が **exact admin origin のみ**

- Before: CORS allowlist に含まれる任意の origin (`*.sloten.io` 等) から POST/PUT/DELETE 可
- After: `sloten-admin-secure.pages.dev` または `env.ADMIN_ORIGINS` で追加された exact origin のみ

**対応**: 管理画面を別 origin でホストしている場合、`wrangler secret put ADMIN_ORIGINS` で追加:
```bash
wrangler secret put ADMIN_ORIGINS
# 値: https://sloten-admin-secure.pages.dev,https://admin.internal.example.com
```

**確認方法**: デプロイ直後に管理画面から何か保存して 403 が出なければ OK。
出た場合のエラーメッセージ: `"CSRF: admin origin required"`

### B3. `/api/widget/conversations/:id` GET が **contact 最小化**

- Before: `contact` に email/phone/metadata/avatar_url/is_identified 全て返す
- After: **`{id, name}` のみ**

**対応**: widget.js が email/phone/metadata を読んでいないか確認。
本リポの widget.js は `contact.id` と `contact.name` しか使っていないので問題なし (確認済)。

---

## 🟡 運用・監視系の変更

### B4. ログインエラーが **全て 401 に統一**

- Before: 401 (wrong password) / 404 (no such user) / 423 (locked)
- After: **全て 401 "Invalid credentials"**

**対応**:
- 監視で 423 を特別扱いしている場合 → 401 に変更
- サポート運用で「アカウントロック中です」と案内していた場合 → もうユーザーに伝わらない

**メリット**: アカウント存在の enumeration 攻撃を防ぐ。

### B5. CSV export に LIMIT + `X-Truncated` ヘッダ

- Before: 無制限 (本番データが育つと Worker OOM リスク)
- After: LIMIT 100000 + 超過時 `X-Truncated: true` ヘッダ

**対応**:
- 全件 export を期待している運用があれば、`X-Truncated: true` で警告される
- 分割 export が必要なら新設 `/api/admin/backup/:table` を使用

### B6. 各種 list endpoint に LIMIT

```
GET /api/faq              500 (query string ?limit= で最大 2000)
GET /api/bot_flows        500
GET /api/bot-menus        500
GET /api/bonus-codes      1000
GET /api/knowledge-sources 1000
GET /api/staff            1000
```

**対応**: 管理 UI が既に pagination を想定していれば問題なし。
単純な "全件取得" を前提にしている場合は `?limit=` で拡大か、pagination 実装を検討。

### B7. 添付ファイル webhook signed URL TTL 短縮

- Before: 24 時間 (`env.ATTACHMENT_URL_TTL_SECONDS` default)
- After: Operator attachment webhook 送信用は **10 分** (その他は 24h 維持)

**対応**: GAS 側で受信後すぐに fetch しているはず → 問題なし。
もし遅延受信してから fetch するバッチがあれば見直し。

---

## 🟢 機能拡張・制限強化 (既存機能に影響薄)

### B8. SVG アップロード拒否

- Before: `image/svg+xml` も `image/*` 系で許可
- After: SVG は **MIME + 拡張子両方で拒否**

```
Upload attempt for image/svg+xml → 400 "mime not allowed"
Upload attempt for .svg extension → 400 "extension not allowed"
```

**既存の SVG データ**: R2 に既に上がっている SVG は消えない。ただし配信時に:
- `Content-Type` を `application/octet-stream` に置換
- `Content-Disposition: attachment` を強制 (inline 不可)
- `Content-Security-Policy: default-src 'none'; sandbox` を追加

結果、SVG を開いても scripting できないし、inline 表示もされない。

**対応**: SVG を積極的に送っている運用があれば PNG に変更を周知。

### B9. Webhook URL 保存時の検証強化

管理画面 `/api/admin/gas-urls` に URL を保存する際:
- `http://` / `https://` 以外は拒否
- loopback (`localhost`, `127.*`, `::1`) 拒否
- RFC-1918 (`10.*`, `172.16-31.*`, `192.168.*`) 拒否
- link-local / AWS IMDS (`169.254.*`) 拒否
- CGNAT (`100.64.*`) 拒否
- IPv6 ULA (`fc00::`, `fd00::`) 拒否
- メタデータ (`metadata.google.internal`, `*.internal`, `*.local`) 拒否
- `env.ALLOWED_WEBHOOK_HOSTS` 設定時は exact host match 必須

**対応**: 既存の正しい GAS URL は全てスルー。もし社内の内部サービスに向けていた場合は拒否される。

### B10. `body.tenant_id` 無視 (POST)

以下のエンドポイントでは POST body の `tenant_id` が **無視される** (セッションから解決):
- `/api/faq`
- `/api/templates`
- `/api/teams`
- `/api/labels`
- `/api/ai-prompts`

**対応**: 管理 UI が `body.tenant_id` を送信していても動作はする (ただし反映されない)。明示的に別テナントに書き込もうとしていた運用があれば要見直し。

### B11. contact_token TTL 30 日 → 7 日

- Before: 30 日
- After: 7 日

**対応**:
- 既発行トークンは従来通り期限まで有効 (再発行時点で 7 日に)
- 7 日以上 widget に触れないユーザーは `contact_token expired` で 401
- widget.js が自動再認証 (契約情報から再 `/api/widget/contacts` POST) する実装になっていれば透過

**既存 widget.js の挙動**: 401 で contact を再生成するロジックがあるか要確認 (時間があれば test)。

### B12. Durable Object WebSocket が独自 auth 検証

- Before: DO は Worker 層の auth を信頼し `?role=` を受容
- After: DO 内で `X-Sloten-Contact-Token` / Cookie セッションを再検証し、
  - 顧客は token の contact_id と conversation の contact_id が一致することを確認
  - スタッフは session から staff.tenant_id を取り、conversation.tenant_id と一致することを確認
  - 失敗時は 401 で upgrade 拒否

**対応**: 通常経路では変化なし。DO binding を直接叩く future code があった場合に影響。

### B13. DO broadcast の `is_private` 判定厳格化

- Before: `msg.is_private === 1 || true` の時のみ staff 限定
- After: `is_private` が明示的に `0/false/'0'/'false'/null` でなければ staff 限定 (default-deny)

**対応**: 通常の code path では変化なし。将来の hand-rolled broadcast で `is_private: '1'` のような stringly-typed 値が来ても customer に漏らさない。

---

## 📋 変更なし (心配無用)

以下は触っていない / 互換性あり:
- 公開 widget JS API (cfg, init, open/close) — 不変
- Bonus code 一致ロジック — 不変
- Deposit flow 挙動 — 不変
- PII マスキング — 不変
- レスポンス filter (AI reply block) — 不変
- ユーザー見える画面 (widget / operator) の機能 — 不変 (UI コード refactor はしたが同等動作)

---

## 🎯 本番投入後に見るべきメトリクス

デプロイ後 1 時間は下記を観察:

| メトリクス | 通常値 | 警告閾値 | 異常時の疑い |
|-----------|--------|---------|-------------|
| Worker 4xx (特に 401/403) | +10%以内 | +30% | B1 (bonus submission) / B2 (admin CSRF) / B4 (login) のどれか |
| Widget 接続 drop rate | +5%以内 | +20% | B11 (contact token expire が多発) |
| R2 attachment upload 失敗 | +10%以内 | +50% | B8 (誰かが SVG を送ろうとしている) |
| GAS webhook 成功率 | 維持 | -20% | B9 (URL 検証で弾かれている可能性、`ALLOWED_WEBHOOK_HOSTS` 再確認) |
| CSV export 使用量 | 維持 | 急減 | B5 (`X-Truncated: true` に気づいてユーザーが諦めた可能性) |

---

## 📋 周知メモ (コピペ用)

```
【本番デプロイ通知 - sloten-standalone】

YYYY/MM/DD HH:MM にデプロイを行います。

■ 影響時間: ダウンタイム無し (Cloudflare Workers の特性上)

■ ユーザー側の変化:
  - Widget: 影響なし (ただし 7 日以上未接続の人は再認証)
  - Operator: ログインエラー文言が統一 ("Invalid credentials")
  - Admin: 管理画面は sloten-admin-secure.pages.dev からのみ操作可
           非 admin staff は /api/bonus-code-submissions 閲覧不可に

■ 運用変化:
  - SVG アップロードは不可 (PNG/JPG/PDF 推奨)
  - CSV export は最大 10 万行 (X-Truncated ヘッダで通知)

■ 緊急時:
  - ロールバック手順: DEPLOY-RUNBOOK.md §10
  - オンコール: (記入)
```
