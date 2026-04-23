# スロ天サイト 埋込 & ユーザー識別子連携ガイド

**目的**: スロ天サイトから Widget を埋め込み、ログイン済ユーザーのアカウント ID を Operator の右サイドバーに自動表示させる。

**対象バージョン**: sloten-standalone version `aafeea8d-b377-...` (2026-04-22 デプロイ、setUser API 実装済)

**Chatwoot 互換性**: `window.$chatwoot.setUser(identifier, userInfo)` と同じ呼出 signature を提供。

---

## 1. 基本埋込 (ログイン前 / 匿名ユーザー)

```html
<!-- スロ天サイト全ページ共通 (footer など) -->
<script
  src="https://chat.sloten.io/widget/widget.js"
  data-api="https://chat.sloten.io"
  data-tenant-id="tenant_default"
  async
></script>
```

これだけで Widget は表示されますが、匿名ユーザーとして扱われます (Operator 側では「識別子」が空欄)。

---

## 2. ログイン後のユーザー識別子設定 (推奨)

### パターン A: 初期化時に data-attribute で渡す

```html
<script
  src="https://chat.sloten.io/widget/widget.js"
  data-api="https://chat.sloten.io"
  data-user-identifier="{{ currentUser.username }}"
  data-user-name="{{ currentUser.displayName }}"
  data-user-email="{{ currentUser.email }}"
  data-user-phone="{{ currentUser.phone }}"
  async
></script>
```

- **ログイン済ユーザーのみ**にレンダリングする (ログイン前は基本埋込のみ)
- サーバーサイドテンプレ (PHP / EJS / Django) で `currentUser` を埋込

### パターン B: Runtime API で後から設定 (Chatwoot 互換)

```html
<script src="https://chat.sloten.io/widget/widget.js" async></script>
<script>
  // ログイン完了後に呼出
  window.addEventListener('sloten-chat-ready', () => {
    window.SlotenChat.setUser(window.currentUser.username, {
      name:  window.currentUser.displayName,
      email: window.currentUser.email,
      phone: window.currentUser.phone,
      custom_attributes: {
        vip_rank: window.currentUser.vipRank,
        registration_date: window.currentUser.registeredAt,
      },
    });
  });
</script>
```

**注**: `sloten-chat-ready` イベントは未実装 — 現状は widget script 読込後なら即呼出可:
```javascript
window.SlotenChat.setUser(identifier, userInfo);
```
呼出タイミングが early すぎる場合 (SlotenChat.setUser が undefined) は 100ms リトライか `<script defer>` を推奨。

### パターン C: SPA (Vue / React) 向け

```javascript
// Vue 3 / Composition API 例
import { onMounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';

export function useSlotenChat() {
  const auth = useAuthStore();
  onMounted(() => {
    // Widget script が head に <script src=".../widget.js" async> で置かれている前提
    const waitReady = () => {
      if (window.SlotenChat) applyUser();
      else setTimeout(waitReady, 100);
    };
    const applyUser = () => {
      if (!auth.isLoggedIn) return;
      window.SlotenChat.setUser(auth.user.username, {
        name: auth.user.displayName,
        email: auth.user.email,
      });
    };
    waitReady();
  });
  watch(() => auth.user?.username, (id) => {
    if (id && window.SlotenChat) {
      window.SlotenChat.setUser(id, {
        name: auth.user.displayName,
        email: auth.user.email,
      });
    }
  });
}
```

```javascript
// React Hook 例
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

export function useSlotenChat() {
  const { user, isLoggedIn } = useAuth();
  useEffect(() => {
    if (!isLoggedIn || !user) return;
    const applyUser = () => {
      if (!window.SlotenChat) { setTimeout(applyUser, 100); return; }
      window.SlotenChat.setUser(user.username, {
        name: user.displayName,
        email: user.email,
        custom_attributes: { vip_rank: user.vipRank },
      });
    };
    applyUser();
  }, [isLoggedIn, user?.username]);
}
```

### パターン D: ログアウト時のクリア

```javascript
function onLogout() {
  if (window.SlotenChat) window.SlotenChat.reset();
  // reset() は localStorage の contact_id / token を破棄し、次回メッセージ時に
  // 匿名ユーザーとして新規 contact を作成する。
}
```

---

## 3. Chatwoot → sloten-standalone の呼出マッピング

| Chatwoot API | sloten-standalone API | 備考 |
|---|---|---|
| `window.$chatwoot.setUser(id, info)` | `window.SlotenChat.setUser(id, info)` | 引数同一、内部 API も同等 |
| `window.$chatwoot.reset()` | `window.SlotenChat.reset()` | localStorage クリア |
| `window.$chatwoot.toggle()` | `window.SlotenChat.open() / close()` | 個別に呼出 |
| `window.chatwootSettings = { ... }` | `window.SlotenChatConfig = { ... }` | 初期化 config |
| `<script ...>chatwootSDK.run()</script>` | `<script src=".../widget.js">` | 自動初期化 |

### `setUser` の引数詳細 (Chatwoot 互換)

```typescript
window.SlotenChat.setUser(
  identifier: string,    // 必須: ユーザーの一意 ID (例: "sloten_user_kazuto0114")
  userInfo: {
    name?: string,               // 表示名
    email?: string,              //
    phone?: string,              // sloten-standalone 拡張
    phone_number?: string,       // Chatwoot 互換名
    avatar_url?: string,         //
    custom_attributes?: object,  // 右サイドバー「カスタム属性」セクションに展開
  }
);
```

### バリデーション

- `identifier` は空文字・null 時は更新なし
- `chatwoot:` 始まりの identifier は **拒否** (内部予約プレフィックス)
- `metadata` は **マージ更新** (既存キー保持)
- 255 文字まで (超過は切り詰め)

---

## 4. Operator 側の表示

### 右サイドバー「ユーザー情報」セクション

```
┌──────────────────────────┐
│ 識別子: sloten_user_xxx  │  ← 太字で目立つ位置 (名前の上)
│ 名前:  kazuto0114        │
│ メール: kazuto@sloten.io  │
│ 電話:  090-1234-5678     │
│ 識別済: はい              │
│ 登録日時: 2026-04-22...   │
│ 最終更新: 2026-04-22...   │
└──────────────────────────┘
```

### 表示優先順位 (fallback)

1. `contact.external_id` (新規 widget 経由の識別子)
2. `metadata.chatwoot_identifier` (Chatwoot import 由来、Telegram ID)
3. `metadata.identifier` / `metadata.external_id` (legacy widget)
4. 空欄

### Migration pointer の扱い

`contact.external_id` が `chatwoot:3:contact:xxxxx` 形式の場合は「**識別子として表示しない**」(Chatwoot インポート参照用で、ユーザー識別子ではないため)。

---

## 5. GAS Webhook への伝播

Bot flow の webhook step が呼ばれる際、payload に以下を含める (自動):

```json
{
  "flow_id": 18,
  "flow_name": "sloten-main",
  "step_id": "bank_transfer",
  "conversation_id": "abc-123",
  "contact": {
    "id": "uuid-here",
    "name": "kazuto0114",
    "email": "kazuto@sloten.io",
    "phone": "090-...",
    "external_id": "sloten_user_kazuto0114"  ← NEW
  },
  "action": "bank_handoff",
  "contact_name": "kazuto0114",
  "chat_id": "uuid-here"
}
```

### GAS 側で識別子を使う (推奨、設定変更が必要)

現状 flow generator は `chat_id: '{{contact.id}}'` (内部 UUID) を送信しています。スロ天アカウント ID を GAS の「電話番号 (ChatID)」列に記録したい場合、admin 画面で **手動で flow body を書き換える** か、generator の template を `{{contact.external_id}}` に変更してください。

例: `scripts/convert-agentbot-messages.mjs` の body 定義を:
```javascript
body: {
  action: 'bank_handoff',
  contact_name: '{{contact.name}}',
  chat_id: '{{contact.external_id}}',  // ← sloten user ID を GAS に渡す
},
```

---

## 6. 埋込済サイトのテスト手順

1. スロ天サイトを開く (ログイン済状態)
2. ブラウザ devtools → Console で:
   ```javascript
   window.SlotenChat.getState()
   // → { contactId: "...", contactToken: "...", conversationId: ... }
   ```
3. Widget を開いてメッセージ送信
4. staging-bk の Operator UI (https://sloten-standalone-staging-bk.rcc-aoki.workers.dev/operator/) を開く
5. 該当 conversation を選択
6. 右サイドバーに「識別子: sloten_user_xxx」が表示されることを確認

### トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 識別子が空欄 | `setUser()` が呼ばれていない | devtools で `window.SlotenChat.getState()` 確認、呼出タイミングを後ろに |
| 識別子が違う値 | localStorage に古い contact が残っている | `window.SlotenChat.reset()` で clear |
| `chatwoot:` で始まる値 | 予約プレフィックス。widget では設定不可 | 別の identifier を使う |
| PATCH 403/401 | contact_token と contactId が不一致 | `.reset()` して再作成 |

---

## 7. セキュリティ注意事項

### identifier を詐称されない対策

現状 `setUser()` は **クライアント側から任意の文字列を送信可能**。悪意あるユーザーが他人の identifier を名乗ることが技術的に可能。

### 対策 (将来実装候補 — Chatwoot の `identifier_hash`)

Chatwoot は HMAC-SHA256 で identifier + secret を署名し、widget から送ることで改ざん防止しています:

```javascript
// Chatwoot の識別子 HMAC 例
window.$chatwoot.setUser(identifier, {
  name, email,
  identifier_hash: '<SHA256 HMAC of (identifier + SECRET)>'
});
```

sloten-standalone では未実装 (Phase 2 検討項目)。現状の運用では:
- 運用者は「widget の識別子は自己申告」と認識して運用
- スロ天サーバー側でセッションから取得した値をテンプレートにレンダリングすれば、CSP と XSS 対策をすれば実用上の脅威は小さい

---

## 8. 関連ドキュメント

- [HANDOFF/13-hybrid-dependency-map.md](13-hybrid-dependency-map.md) — sloten ↔ GAS 責任分担
- [HANDOFF/14-gas-update-sop.md](14-gas-update-sop.md) — GAS 更新手順
- [HANDOFF/15-staging-bk-qa-report.md](15-staging-bk-qa-report.md) — staging-bk QA 結果
- Chatwoot 公式: https://www.chatwoot.com/docs/product/channels/live-chat/sdk/identity-validation
