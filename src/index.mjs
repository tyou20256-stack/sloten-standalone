// Sloten Standalone — Phase 1 Worker entry point.
// Self-contained chat backend (no Chatwoot).
//
// Routing model (2026-05-13 refactor):
//   - Special routes (health probes, static assets, WebSocket upgrades, and
//     the widget routes that need contact-token-plus-conversation-ownership
//     checks) stay inline near the top of fetch() — their logic is too coupled
//     to env bindings or per-request closures to fit a declarative table.
//   - All standard CRUD endpoints live in the ROUTES table at the bottom of
//     this file. Each entry declares its method(s), path pattern, handler,
//     auth mode, and (rarely) extra arguments. dispatchRoute walks the table
//     in order and short-circuits on the first match.
//
// Adding a new endpoint:
//   1. Find the section in ROUTES that matches the resource ("Bonus codes",
//      "AI logs", etc.) and add the entry there.
//   2. If the handler needs more than (request, env, corsHeaders, ...params),
//      add `extras: [...]` — the dispatcher splices them in before ctx.
//   3. If the route needs custom verification beyond requireStaff /
//      requireAdminRole, keep it inline rather than forcing the table to
//      learn another auth mode.

import { buildCorsHeaders, handleCorsPreflight, isAllowedOrigin } from './cors-helper.mjs';
import { checkRateLimit, rateLimitResponse } from './rate-limiter.mjs';
import { ok, err } from './json.mjs';
import { uuid } from './id.mjs';

import {
  handleFaqGet, handleFaqGetOne, handleFaqPost, handleFaqPut, handleFaqDelete, handleFaqSearch,
} from './handlers/faq.mjs';
import {
  handleTemplatesGet, handleTemplatesPost, handleTemplatesPut, handleTemplatesDelete,
} from './handlers/templates.mjs';
import {
  handleKnowledgeSourcesGet, handleKnowledgeSourcesGetOne,
  handleKnowledgeSourcesPost, handleKnowledgeSourcesPut, handleKnowledgeSourcesDelete,
} from './handlers/knowledge-sources.mjs';
import {
  createContact, getContact, listContacts, listContactConversations, updateContact,
} from './handlers/contacts-native.mjs';
import {
  createConversation, listConversations, getConversation, updateConversation, markRead,
} from './handlers/conversations-native.mjs';
import { searchHandler } from './handlers/search.mjs';
import { listLabels, createLabel, updateLabel, deleteLabel } from './handlers/labels.mjs';
import {
  listStaff, listStaffLookup, createStaff, updateStaff, deleteStaff, resetStaffPassword, importStaffFromChatwoot,
} from './handlers/staff-admin.mjs';
import { dashboardStats } from './handlers/dashboard.mjs';
import { exportCsv } from './handlers/export.mjs';
import { listAiLogs, getAiLog, deleteAiLog, submitFeedback, aiStats, listSilentFailures } from './handlers/ai-logs.mjs';
import {
  listGoldenSet, createGoldenRow, updateGoldenRow, deleteGoldenRow, evalResults,
  getShadowConfig, setShadowConfig,
} from './handlers/golden-set.mjs';
import {
  vectorizeReindex, vectorizeQuery, vectorizeState, setVectorizeFlags,
} from './handlers/vectorize.mjs';
import {
  clusterFaqCandidates, listClusters, clusterMembers,
} from './handlers/faq-clustering.mjs';
import {
  listTeams, createTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember,
} from './handlers/teams.mjs';
import {
  listPrompts, createPrompt, updatePrompt, deletePrompt,
} from './handlers/ai-prompts.mjs';
import { handleScheduled } from './scheduled.mjs';
import { verifyContactToken, extractContactToken } from './auth/contact-token.mjs';
import { listBotMenus, createBotMenu, updateBotMenu, deleteBotMenu } from './handlers/bot-menus.mjs';
import { listBotFlows, createBotFlow, updateBotFlow, deleteBotFlow } from './handlers/bot-flows.mjs';
import { listBonusCodes, createBonusCode, updateBonusCode, deleteBonusCode, listBonusSubmissions } from './handlers/bonus-codes-admin.mjs';
import { adminTestBot, listGasUrls, setGasUrl, pingGasUrl, listAuditLog, listErrorLog, adminBackup, adminRestore, adminMenuTree } from './handlers/admin-ops.mjs';
import { flushGenaiCache, flushFaqCache, cacheStats } from './handlers/cache-admin.mjs';
import { exportContactData, eraseContactData } from './handlers/gdpr.mjs';
import { uploadAttachment, downloadAttachment, downloadAttachmentSigned } from './handlers/attachments.mjs';
import { getPublicJackpot } from './handlers/public-jackpot.mjs';
import {
  handlePachiSearch, handlePachiMachineGet, handlePachiSimilar, handlePachiChat,
} from './handlers/pachi-machines.mjs';
import {
  listCandidates, updateCandidate, approveCandidate, rejectCandidate, bulkAction, runExtractionNow,
} from './handlers/faq-candidates.mjs';
import {
  sendMessage, listMessages,
} from './handlers/messages-native.mjs';
import {
  loginHandler, logoutHandler, meHandler, resolveStaffFromCookie,
} from './handlers/staff-auth.mjs';

export { ConversationRoom } from './durable/conversation-room.mjs';

function forwardToConversationRoom(env, conversationId, role, request) {
  if (!env.CONVERSATION_ROOM) return new Response('DO binding missing', { status: 503 });
  const id = env.CONVERSATION_ROOM.idFromName(conversationId);
  const stub = env.CONVERSATION_ROOM.get(id);
  const u = new URL(`https://do/ws?conversation_id=${encodeURIComponent(conversationId)}&role=${role}`);
  return stub.fetch(u.toString(), request);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  return !!env.ADMIN_API_TOKEN && timingSafeEqual(m[1], env.ADMIN_API_TOKEN);
}

// CSRF defense: for cookie-auth state-changing requests (POST/PUT/PATCH/DELETE)
// require same-origin indicator. Bearer-token callers are API-to-API and
// bypass this check.
function csrfCheck(request, env) {
  if (bearerAuth(request, env)) return true;
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const sfs = request.headers.get('Sec-Fetch-Site');
  if (sfs === 'same-origin') return true;
  const origin = request.headers.get('Origin');
  if (origin && isAllowedOrigin(origin, env)) return true;
  return false;
}

// Cookie (any active staff) OR Bearer admin. GET-only sensible usage; writes
// go through requireAdminRole for admin-only gating.
function requireStaff(handler) {
  return async (request, env, corsHeaders, ...rest) => {
    if (bearerAuth(request, env)) return handler(request, env, corsHeaders, ...rest);
    if (!csrfCheck(request, env)) return err('CSRF: Origin/Sec-Fetch-Site rejected', 403, corsHeaders);
    const staff = await resolveStaffFromCookie(request, env);
    if (staff) {
      request.__staff = staff;
      const resp = await handler(request, env, corsHeaders, ...rest);
      if (staff._refreshedCookie) {
        const nr = new Response(resp.body, resp);
        nr.headers.append('Set-Cookie', staff._refreshedCookie);
        return nr;
      }
      return resp;
    }
    return err('Unauthorized', 401, corsHeaders);
  };
}

// Admin-role-only: Bearer (super-admin) OR cookie staff with role='admin'.
function requireAdminRole(handler) {
  return async (request, env, corsHeaders, ...rest) => {
    if (bearerAuth(request, env)) return handler(request, env, corsHeaders, ...rest);
    if (!csrfCheck(request, env)) return err('CSRF: Origin/Sec-Fetch-Site rejected', 403, corsHeaders);
    const staff = await resolveStaffFromCookie(request, env);
    if (staff && staff.role === 'admin') {
      request.__staff = staff;
      const resp = await handler(request, env, corsHeaders, ...rest);
      if (staff._refreshedCookie) {
        const nr = new Response(resp.body, resp);
        nr.headers.append('Set-Cookie', staff._refreshedCookie);
        return nr;
      }
      return resp;
    }
    return err(staff ? 'Forbidden (admin only)' : 'Unauthorized', staff ? 403 : 401, corsHeaders);
  };
}

// Route dispatcher: walks ROUTES in order, returns the handler's Response on
// first match or null if nothing matched (caller falls through to 404).
//
// Pattern types:
//   - string: exact path match
//   - RegExp: capture groups become trailing handler args, in order.
//
// Per-entry options:
//   intParams: indices of params to parseInt(_, 10) before passing.
//   extras: extra args spliced in between params and ctx (e.g. `{}` opts).
//   auth: 'public' | 'staff' | 'admin'
async function dispatchRoute(routes, request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  for (const r of routes) {
    const methods = Array.isArray(r.m) ? r.m : [r.m];
    if (!methods.includes(method)) continue;
    let params;
    if (typeof r.p === 'string') {
      if (path !== r.p) continue;
      params = [];
    } else {
      const m = path.match(r.p);
      if (!m) continue;
      params = m.slice(1);
      if (r.intParams) {
        params = params.map((v, i) => (r.intParams.includes(i) ? parseInt(v, 10) : v));
      }
    }
    let handler = r.h;
    if (r.auth === 'admin') handler = requireAdminRole(handler);
    else if (r.auth === 'staff') handler = requireStaff(handler);
    const extras = r.extras || [];
    return handler(request, env, corsHeaders, ...params, ...extras, ctx);
  }
  return null;
}

export default {
  async scheduled(event, env, ctx) {
    return handleScheduled(event, env, ctx);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    const method = request.method.toUpperCase();
    const corsHeaders = buildCorsHeaders(request, env);

    // /api/v1 alias (audit C7, 2026-05-13): introduce the version-prefix
    // namespace without breaking the existing unversioned surface. New
    // breaking changes can land under /api/v1/... while /api/... stays
    // frozen-compatible. We normalise the prefix off here so handlers and
    // route table entries don't need duplicate definitions.
    if (path.startsWith('/api/v1/')) path = '/api/' + path.slice('/api/v1/'.length);

    // Trace correlation id (audit C6, 2026-05-13): stamped on every request
    // and propagated to outbound webhook headers (X-Sloten-Trace-Id) plus
    // every response so incident-response can join logs across surfaces.
    // Honour an inbound X-Sloten-Trace-Id when the caller is the trusted
    // bearer-admin token; otherwise generate.
    const inboundTrace = request.headers.get('X-Sloten-Trace-Id');
    const isTrustedBearer = /^Bearer\s+(.+)$/.test(request.headers.get('Authorization') || '')
      && !!env.ADMIN_API_TOKEN;
    request.__trace_id = (inboundTrace && isTrustedBearer && /^[a-f0-9-]{16,40}$/i.test(inboundTrace))
      ? inboundTrace
      : uuid();
    // CORS-allowed header so the trace id surfaces in fetch() callers.
    corsHeaders['X-Sloten-Trace-Id'] = request.__trace_id;

    if (method === 'OPTIONS') return handleCorsPreflight(request, env);

    try {
      // ── Public probes + static assets + redirects ────────────────────
      // Build / version info — useful for debug, ops dashboards, and rollback.
      if (path === '/version' && method === 'GET') {
        return ok({
          worker_version: env.CF_VERSION_METADATA?.id || null,
          environment: env.ENVIRONMENT || 'unknown',
          ai_provider: env.AI_PROVIDER || 'gemini',
          has_anthropic_fallback: !!env.ANTHROPIC_API_KEY,
          features: {
            classifier_shadow_mode: true,
            response_cache: true,
            dynamic_rag_reduction: true,
            synthetic_uptime: true,
            db_analyze_weekly: true,
          },
          tenant: env.DEFAULT_TENANT_ID || 'tenant_default',
          timestamp: new Date().toISOString(),
        }, corsHeaders);
      }
      // Per-binding deep health probes.
      if (path === '/health/db' && method === 'GET') {
        try {
          const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE created_at > datetime(\'now\', \'-1 hour\')').first();
          return ok({ status: 'ok', binding: 'DB', recent_messages_1h: r?.n ?? null }, corsHeaders);
        } catch (e) {
          return new Response(JSON.stringify({ status: 'error', binding: 'DB', error: e.message }),
            { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }
      if (path === '/health/kv' && method === 'GET') {
        const probe = `health:probe:${Date.now()}`;
        try {
          const kv = env.RATE_LIMITER || env.STATE_KV || env.SESSION_KV;
          if (!kv) return new Response('{"status":"missing","binding":"KV"}', { status: 503, headers: corsHeaders });
          await kv.put(probe, '1', { expirationTtl: 60 });
          const v = await kv.get(probe);
          await kv.delete(probe);
          return ok({ status: v === '1' ? 'ok' : 'degraded', binding: 'KV', round_trip_ok: v === '1' }, corsHeaders);
        } catch (e) {
          return new Response(JSON.stringify({ status: 'error', binding: 'KV', error: e.message }),
            { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }
      if (path === '/health/r2' && method === 'GET') {
        if (!env.FILES) return new Response('{"status":"missing","binding":"R2"}', { status: 503, headers: corsHeaders });
        try {
          const r = await env.FILES.list({ limit: 1 });
          return ok({ status: 'ok', binding: 'R2', objects_visible: r.objects?.length ?? 0 }, corsHeaders);
        } catch (e) {
          return new Response(JSON.stringify({ status: 'error', binding: 'R2', error: e.message }),
            { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }
      if (path === '/health/vectorize' && method === 'GET') {
        if (!env.VECTORIZE) return new Response('{"status":"missing","binding":"VECTORIZE"}', { status: 503, headers: corsHeaders });
        try {
          const r = await env.VECTORIZE.describe?.();
          return ok({ status: 'ok', binding: 'VECTORIZE', dimensions: r?.config?.dimensions ?? null }, corsHeaders);
        } catch (e) {
          return new Response(JSON.stringify({ status: 'error', binding: 'VECTORIZE', error: e.message }),
            { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }
      if (path === '/health/pachi' && method === 'GET') {
        if (!env.PACHI_API_URL) return new Response('{"status":"disabled","binding":"PACHI"}', { status: 200, headers: corsHeaders });
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 4000);
          const r = await fetch(`${env.PACHI_API_URL}/health`, { signal: ac.signal,
            headers: env.PACHI_API_KEY ? { Authorization: `Bearer ${env.PACHI_API_KEY}` } : {} });
          clearTimeout(t);
          return ok({ status: r.ok ? 'ok' : 'degraded', binding: 'PACHI', upstream: r.status }, corsHeaders);
        } catch (e) {
          return new Response(JSON.stringify({ status: 'error', binding: 'PACHI', error: e.message }),
            { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }
      if (path === '/health' && method === 'GET') {
        // Deep health: verify DB reachable + critical env presence.
        const CRITICAL_SECRETS = ['GEMINI_API_KEY'];
        const CRITICAL_SIGNING_KEYS = ['SESSION_SIGNING_KEY', 'STAFF_SESSION_SIGNING_KEY'];
        const OPTIONAL = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY',
                          'BANK_TRANSFER_BOT_WEBHOOK_URL', 'GAS_BOT_WEBHOOK_URL',
                          'EC_DEPOSIT_BOT_WEBHOOK_URL', 'BONUS_CODE_WEBHOOK_URL',
                          'CONTACT_TOKEN_SIGNING_KEY', 'RAG_CACHE_SIGNING_KEY'];
        const missingCritical = CRITICAL_SECRETS.filter((k) => !env[k]);
        const hasAnySigningKey = CRITICAL_SIGNING_KEYS.some((k) => env[k]);
        if (!hasAnySigningKey) missingCritical.push('SIGNING_KEY (any of: ' + CRITICAL_SIGNING_KEYS.join('|') + ')');
        const missingOptional = OPTIONAL.filter((k) => !env[k]);
        try {
          const dbCheck = await env.DB.prepare('SELECT 1 AS ping').first();
          const kvCheck = env.SESSION_KV ? 'ok' : 'missing';
          const status = (missingCritical.length === 0 && dbCheck?.ping === 1) ? 'ok' : 'degraded';
          const httpStatus = status === 'ok' ? 200 : 503;
          return new Response(JSON.stringify({
            status,
            db: dbCheck?.ping === 1 ? 'ok' : 'error',
            kv: kvCheck,
            env: {
              critical_missing: missingCritical,
              optional_missing: missingOptional,
              critical_count: CRITICAL_SECRETS.length + 1,
              optional_count: OPTIONAL.length,
            },
            timestamp: new Date().toISOString(),
          }), { status: httpStatus, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } catch (e) {
          return new Response(JSON.stringify({
            status: 'degraded',
            db: 'error',
            error: e.message,
            env: { critical_missing: missingCritical, optional_missing: missingOptional },
            timestamp: new Date().toISOString(),
          }), { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }
      if (path === '/api/public/jackpot' && method === 'GET') {
        return getPublicJackpot(request, env, corsHeaders, ctx);
      }

      // /widget alias → /widget/index.html (convenience).
      if (path === '/widget' && method === 'GET') return Response.redirect(new URL('/widget/', request.url).toString(), 302);
      if (path === '/operator' && method === 'GET') return Response.redirect(new URL('/operator/', request.url).toString(), 302);
      if (path === '/admin' && method === 'GET') return Response.redirect(new URL('/admin/', request.url).toString(), 302);

      // Static assets — serve from ASSETS binding.
      if (env.ASSETS && (path.startsWith('/widget/') || path.startsWith('/operator/') || path.startsWith('/admin/') || path.startsWith('/shared/')) && method === 'GET') {
        const assetRes = await env.ASSETS.fetch(request);
        // Force browsers + CF edges to always revalidate widget/operator/admin
        // JS+CSS so bug fixes propagate within seconds, not hours.
        if (assetRes.ok && /\.(m?js|css|html)$/.test(path)) {
          const headers = new Headers(assetRes.headers);
          headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          headers.set('Pragma', 'no-cache');
          headers.set('Expires', '0');
          return new Response(assetRes.body, { status: assetRes.status, headers });
        }
        return assetRes;
      }

      // ── Staff auth (cookie-based) ────────────────────────────────────
      if (path === '/api/staff/login' && method === 'POST') {
        // IP-level rate limit to stop credential-stuffing across many accounts.
        // critical:true → KV write fail-closed so an attacker can't bypass
        // the counter via KV outage (Security #7).
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `login:${ip}`, 10, 60, ctx, { critical: true });
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
        return loginHandler(request, env, corsHeaders);
      }
      if (path === '/api/staff/logout' && method === 'POST') {
        // Soft CSRF guard: logout should not be forceable from another origin.
        if (!csrfCheck(request, env)) return err('CSRF: Origin/Sec-Fetch-Site rejected', 403, corsHeaders);
        return logoutHandler(request, env, corsHeaders);
      }
      if (path === '/api/staff/me' && method === 'GET') return meHandler(request, env, corsHeaders);

      // ── Attachments (token-gated for widget, staff-gated for admin) ──
      // Widget customer upload: token-gated, own conversation only.
      {
        const m = path.match(/^\/api\/widget\/conversations\/([^/]+)\/attachments$/);
        if (m && method === 'POST') {
          const token = extractContactToken(request);
          const payload = await verifyContactToken(env, token);
          if (!payload) return err('Unauthorized (widget contact token required)', 401, corsHeaders);
          const conv = await env.DB.prepare('SELECT contact_id FROM conversations WHERE id = ?').bind(m[1]).first();
          if (!conv) return err('Conversation not found', 404, corsHeaders);
          if (conv.contact_id !== payload.cid) return err('Forbidden (contact mismatch)', 403, corsHeaders);
          return uploadAttachment(request, env, corsHeaders, m[1], 'customer');
        }
      }
      // Widget customer download: token-gated.
      {
        const m = path.match(/^\/api\/widget\/attachments\/([^/]+)$/);
        if (m && method === 'GET') {
          const token = extractContactToken(request);
          const payload = await verifyContactToken(env, token);
          if (!payload) return err('Unauthorized (widget contact token required)', 401, corsHeaders);
          const row = await env.DB.prepare('SELECT conversation_id FROM attachments WHERE id = ?').bind(m[1]).first();
          if (!row) return err('Attachment not found', 404, corsHeaders);
          const conv = await env.DB.prepare('SELECT contact_id FROM conversations WHERE id = ?').bind(row.conversation_id).first();
          if (!conv || conv.contact_id !== payload.cid) return err('Forbidden', 403, corsHeaders);
          return downloadAttachment(request, env, corsHeaders, m[1]);
        }
      }
      // Staff upload (admin console).
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)\/attachments$/);
        if (m && method === 'POST') return requireStaff(uploadAttachment)(request, env, corsHeaders, m[1], 'staff');
      }
      // Staff download (signed-URL bypass for GAS / webhook callers).
      {
        const m = path.match(/^\/api\/attachments\/([^/]+)$/);
        if (m && method === 'GET') {
          const u = new URL(request.url);
          if (u.searchParams.has('sig') && u.searchParams.has('exp')) {
            return downloadAttachmentSigned(request, env, corsHeaders, m[1]);
          }
          return requireStaff(downloadAttachment)(request, env, corsHeaders, m[1]);
        }
      }

      // ── WebSocket upgrades → ConversationRoom Durable Object ─────────
      {
        const upgrade = request.headers.get('Upgrade');
        let m;
        if ((m = path.match(/^\/ws\/widget\/conversations\/([^/]+)$/))) {
          if (upgrade !== 'websocket') return err('Expected WebSocket upgrade', 426, corsHeaders);
          const token = extractContactToken(request);
          const payload = await verifyContactToken(env, token);
          if (!payload) return err('Unauthorized (widget contact token required)', 401, corsHeaders);
          const conv = await env.DB.prepare('SELECT contact_id FROM conversations WHERE id = ?').bind(m[1]).first();
          if (!conv) return err('Conversation not found', 404, corsHeaders);
          if (conv.contact_id !== payload.cid) return err('Forbidden (contact mismatch)', 403, corsHeaders);
          return forwardToConversationRoom(env, m[1], 'customer', request);
        }
        if ((m = path.match(/^\/ws\/operator\/conversations\/([^/]+)$/))) {
          if (upgrade !== 'websocket') return err('Expected WebSocket upgrade', 426, corsHeaders);
          const staff = await resolveStaffFromCookie(request, env);
          if (!bearerAuth(request, env) && !staff) return err('Unauthorized', 401, corsHeaders);
          return forwardToConversationRoom(env, m[1], 'operator', request);
        }
      }

      // ── Widget-facing public/token routes ────────────────────────────
      // Rate-limited: 120 requests per minute per IP. Normal menu navigation
      // should never hit this; burst abuse still gets throttled quickly.
      if (method !== 'GET' && method !== 'OPTIONS' && path.startsWith('/api/widget/')) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `widget:${ip}`, 120, 60, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
      }

      // Public contact creation — the one widget endpoint that doesn't require
      // a contact_token (because the caller doesn't have one yet).
      if (path === '/api/widget/contacts' && method === 'POST') return createContact(request, env, corsHeaders);

      // Explicit token revocation — widget calls this on "ログアウト" / shared
      // device cleanup. Server-side equivalent of localStorage clear.
      if (path === '/api/widget/contacts/logout' && method === 'POST') {
        const token = extractContactToken(request);
        const payload = await verifyContactToken(env, token);
        if (!payload) return err('Unauthorized', 401, corsHeaders);
        const { revokeContactJti } = await import('./auth/contact-token.mjs');
        const remainingSec = Math.max(60, payload.exp - Math.floor(Date.now() / 1000));
        await revokeContactJti(env, payload.jti, remainingSec);
        return ok({ success: true, revoked: true }, corsHeaders);
      }

      // PATCH /api/widget/contacts/:id — runtime profile update (Chatwoot
      // `$chatwoot.setUser()` equivalent). Verifies contact_token ownership.
      {
        const m = path.match(/^\/api\/widget\/contacts\/([^/]+)$/);
        if (m && method === 'PATCH') return updateContact(request, env, corsHeaders, m[1]);
      }

      // Helper closure: verify contact_token matches the conversation's contact_id.
      async function verifyWidgetOwnership(conversationId) {
        const token = extractContactToken(request);
        const payload = await verifyContactToken(env, token);
        if (!payload) return { ok: false, response: err('Unauthorized (widget contact token required)', 401, corsHeaders) };
        const conv = await env.DB.prepare('SELECT contact_id FROM conversations WHERE id = ?').bind(conversationId).first();
        if (!conv) return { ok: false, response: err('Conversation not found', 404, corsHeaders) };
        if (conv.contact_id !== payload.cid) return { ok: false, response: err('Forbidden (contact mismatch)', 403, corsHeaders) };
        return { ok: true, contactId: payload.cid };
      }

      if (path === '/api/widget/conversations' && method === 'POST') {
        // conversation create: verify token matches body.contact_id
        let body; try { body = await request.clone().json(); } catch { body = {}; }
        const token = extractContactToken(request);
        const payload = await verifyContactToken(env, token);
        if (!payload) return err('Unauthorized (widget contact token required)', 401, corsHeaders);
        if (body.contact_id && body.contact_id !== payload.cid) {
          return err('Forbidden (contact mismatch)', 403, corsHeaders);
        }
        return createConversation(request, env, corsHeaders);
      }
      {
        const m = path.match(/^\/api\/widget\/conversations\/([^/]+)\/messages$/);
        if (m) {
          const check = await verifyWidgetOwnership(m[1]);
          if (!check.ok) return check.response;
          if (method === 'POST') return sendMessage(request, env, corsHeaders, m[1], { source: 'widget' }, ctx);
          if (method === 'GET')  return listMessages(request, env, corsHeaders, m[1], { source: 'widget' });
        }
      }
      {
        const m = path.match(/^\/api\/widget\/conversations\/([^/]+)$/);
        if (m && method === 'GET') {
          const check = await verifyWidgetOwnership(m[1]);
          if (!check.ok) return check.response;
          // verifyWidgetOwnership already confirmed contact_id ownership; tell
          // getConversation to skip its own tenant-scope check (the widget has
          // no staff cookie / bearer to drive resolveTenantId).
          return getConversation(request, env, corsHeaders, m[1], { ownershipChecked: true });
        }
      }

      // ── Public FAQ search (rate-limited) ─────────────────────────────
      if (path === '/api/faq/search' && method === 'GET') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `faqsearch:${ip}`, 60, 60, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
        return handleFaqSearch(request, env, corsHeaders);
      }

      // ── Standard CRUD routes via dispatch table ──────────────────────
      const tableResp = await dispatchRoute(ROUTES, request, env, corsHeaders, ctx);
      if (tableResp) return tableResp;

      return err('Not Found', 404, corsHeaders);
    } catch (e) {
      console.error('[fetch]', e?.stack || e?.message || e);
      return err('Internal Server Error', 500, corsHeaders);
    }
  },
};

// ─── Standard CRUD route table ──────────────────────────────────────
// Conventions:
//   m: HTTP method (or array)
//   p: path pattern (string for exact match, RegExp with capture groups)
//   h: handler function
//   auth: 'admin' | 'staff' | 'public'
//   intParams: indices of capture groups to parseInt before passing
//   extras: extra args spliced in after route params, before ctx
//
// ORDERING RULES (avoid auth-bypass regressions — Security audit H-5):
//   1. Within a (method, prefix) family, exact-string routes MUST appear
//      before any RegExp routes that could match them. Example:
//        ✓ { m: 'GET', p: '/api/staff/lookup', ..., auth: 'staff' }   ← first
//          { m: 'PATCH', p: /^\/api\/staff\/(\d+)$/, ..., auth: 'admin' }
//      The regex below is `\d+`-constrained today, but if a future regex
//      `(.+)` is added it would shadow the lookup route and silently
//      escalate it to admin-only (or worse, mismatch the handler).
//   2. dispatchRoute returns the FIRST match — never compose patterns
//      that overlap unless the intent is documented inline.
//   3. New routes should match the surrounding section's auth convention
//      (read = 'staff', write = 'admin') unless documented otherwise.
const ROUTES = [
  // ── Contacts (staff) ──
  { m: 'GET', p: '/api/contacts', h: listContacts, auth: 'staff' },
  { m: 'GET', p: /^\/api\/contacts\/([^/]+)\/conversations$/, h: listContactConversations, auth: 'staff' },
  { m: 'GET', p: /^\/api\/contacts\/([^/]+)$/, h: getContact, auth: 'staff' },

  // ── Conversations (staff view) ──
  { m: 'GET',   p: '/api/conversations', h: listConversations, auth: 'staff' },
  { m: 'GET',   p: /^\/api\/conversations\/([^/]+)$/, h: getConversation, auth: 'staff' },
  { m: 'PATCH', p: /^\/api\/conversations\/([^/]+)$/, h: updateConversation, auth: 'staff' },
  { m: 'GET',   p: /^\/api\/conversations\/([^/]+)\/messages$/, h: listMessages, auth: 'staff' },
  { m: 'POST',  p: /^\/api\/conversations\/([^/]+)\/messages$/, h: sendMessage, auth: 'staff', extras: [{}] },
  { m: 'POST',  p: /^\/api\/conversations\/([^/]+)\/mark_read$/, h: markRead, auth: 'staff' },

  // ── Search + Dashboard ──
  { m: 'GET', p: '/api/search', h: searchHandler, auth: 'staff' },
  { m: 'GET', p: '/api/dashboard/stats', h: dashboardStats, auth: 'staff' },

  // ── Staff admin ──
  { m: 'GET',    p: '/api/staff', h: listStaff, auth: 'admin' },
  { m: 'GET',    p: '/api/staff/lookup', h: listStaffLookup, auth: 'staff' },
  { m: 'POST',   p: '/api/staff', h: createStaff, auth: 'admin' },
  { m: 'POST',   p: '/api/staff/import_from_chatwoot', h: importStaffFromChatwoot, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/staff\/(\d+)$/, h: updateStaff, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/staff\/(\d+)$/, h: deleteStaff, auth: 'admin', intParams: [0] },
  { m: 'POST',   p: /^\/api\/staff\/(\d+)\/reset_password$/, h: resetStaffPassword, auth: 'admin', intParams: [0] },

  // ── Export CSV ──
  { m: 'GET', p: /^\/api\/export\/([a-z_]+)\.csv$/, h: exportCsv, auth: 'admin' },

  // ── Teams — reads = staff, writes = admin ──
  { m: 'GET',    p: '/api/teams', h: listTeams, auth: 'staff' },
  { m: 'POST',   p: '/api/teams', h: createTeam, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/teams\/(\d+)$/, h: updateTeam, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/teams\/(\d+)$/, h: deleteTeam, auth: 'admin', intParams: [0] },
  { m: 'POST',   p: /^\/api\/teams\/(\d+)\/members$/, h: addTeamMember, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/teams\/(\d+)\/members\/(\d+)$/, h: removeTeamMember, auth: 'admin', intParams: [0, 1] },

  // ── FAQ candidates (weekly extraction) — reads = staff, ops = admin ──
  { m: 'GET',    p: '/api/faq-candidates', h: listCandidates, auth: 'staff' },
  { m: 'POST',   p: '/api/faq-candidates/run', h: runExtractionNow, auth: 'admin' },
  { m: 'POST',   p: '/api/faq-candidates/bulk', h: bulkAction, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/faq-candidates\/(\d+)$/, h: updateCandidate, auth: 'admin', intParams: [0] },
  { m: 'POST',   p: /^\/api\/faq-candidates\/(\d+)\/approve$/, h: approveCandidate, auth: 'admin', intParams: [0] },
  { m: 'POST',   p: /^\/api\/faq-candidates\/(\d+)\/reject$/, h: rejectCandidate, auth: 'admin', intParams: [0] },

  // ── Bot flows (multi-step workflows) ──
  { m: 'GET',    p: '/api/bot-flows', h: listBotFlows, auth: 'staff' },
  { m: 'POST',   p: '/api/bot-flows', h: createBotFlow, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/bot-flows\/(\d+)$/, h: updateBotFlow, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/bot-flows\/(\d+)$/, h: deleteBotFlow, auth: 'admin', intParams: [0] },

  // ── Bonus codes ──
  { m: 'GET',    p: '/api/bonus-codes', h: listBonusCodes, auth: 'staff' },
  { m: 'POST',   p: '/api/bonus-codes', h: createBonusCode, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/bonus-codes\/(\d+)$/, h: updateBonusCode, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/bonus-codes\/(\d+)$/, h: deleteBonusCode, auth: 'admin', intParams: [0] },
  { m: 'GET',    p: '/api/bonus-code-submissions', h: listBonusSubmissions, auth: 'staff' },

  // ── Admin operations (test-bot, GAS URLs, audit, backup, cache, GDPR) ──
  { m: 'POST', p: '/api/admin/test-bot', h: adminTestBot, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/gas-urls', h: listGasUrls, auth: 'admin' },
  { m: 'POST', p: '/api/admin/gas-urls', h: setGasUrl, auth: 'admin' },
  { m: 'POST', p: '/api/admin/gas-ping', h: pingGasUrl, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/audit-log', h: listAuditLog, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/error-log', h: listErrorLog, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/backup', h: adminBackup, auth: 'admin' },
  { m: 'POST', p: '/api/admin/restore', h: adminRestore, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/menu-tree', h: adminMenuTree, auth: 'staff' },
  { m: 'POST', p: '/api/admin/cache/flush', h: flushGenaiCache, auth: 'admin' },
  { m: 'POST', p: '/api/admin/cache/flush-faq', h: flushFaqCache, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/cache/stats', h: cacheStats, auth: 'admin' },
  { m: 'GET',  p: /^\/api\/admin\/gdpr\/contact\/([^/]+)$/, h: exportContactData, auth: 'admin' },
  { m: 'POST', p: /^\/api\/admin\/gdpr\/contact\/([^/]+)\/erase$/, h: eraseContactData, auth: 'admin' },

  // ── Bot menus ──
  { m: 'GET',    p: '/api/bot-menus', h: listBotMenus, auth: 'staff' },
  { m: 'POST',   p: '/api/bot-menus', h: createBotMenu, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/bot-menus\/(\d+)$/, h: updateBotMenu, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/bot-menus\/(\d+)$/, h: deleteBotMenu, auth: 'admin', intParams: [0] },

  // ── AI prompts ──
  { m: 'GET',    p: '/api/ai-prompts', h: listPrompts, auth: 'admin' },
  { m: 'POST',   p: '/api/ai-prompts', h: createPrompt, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/ai-prompts\/(\d+)$/, h: updatePrompt, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/ai-prompts\/(\d+)$/, h: deletePrompt, auth: 'admin', intParams: [0] },

  // ── AI logs + feedback (TEXT UUID ids since migration 027) ──
  { m: 'GET',    p: '/api/ai-logs', h: listAiLogs, auth: 'admin' },
  { m: 'GET',    p: '/api/ai-logs/stats', h: aiStats, auth: 'admin' },
  { m: 'GET',    p: '/api/ai-logs/silent-failures', h: listSilentFailures, auth: 'admin' },
  { m: 'GET',    p: /^\/api\/ai-logs\/([^/]+)$/, h: getAiLog, auth: 'admin' },
  { m: 'DELETE', p: /^\/api\/ai-logs\/([^/]+)$/, h: deleteAiLog, auth: 'admin' },
  { m: 'POST',   p: /^\/api\/ai-logs\/([^/]+)\/feedback$/, h: submitFeedback, auth: 'admin' },

  // ── Golden Set + shadow mode (Phase 2) ──
  { m: 'GET',    p: '/api/golden-set', h: listGoldenSet, auth: 'admin' },
  { m: 'POST',   p: '/api/golden-set', h: createGoldenRow, auth: 'admin' },
  { m: 'PATCH',  p: /^\/api\/golden-set\/(\d+)$/, h: updateGoldenRow, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/golden-set\/(\d+)$/, h: deleteGoldenRow, auth: 'admin', intParams: [0] },
  { m: 'GET',    p: '/api/golden-eval', h: evalResults, auth: 'admin' },
  { m: 'GET',    p: '/api/admin/shadow-config', h: getShadowConfig, auth: 'admin' },
  { m: 'POST',   p: '/api/admin/shadow-config', h: setShadowConfig, auth: 'admin' },

  // ── Vectorize (Phase 2b) ──
  { m: 'POST', p: '/api/admin/vectorize/reindex', h: vectorizeReindex, auth: 'admin' },
  { m: 'POST', p: '/api/admin/vectorize/query',   h: vectorizeQuery,   auth: 'admin' },
  { m: 'GET',  p: '/api/admin/vectorize/state',   h: vectorizeState,   auth: 'admin' },
  { m: 'POST', p: '/api/admin/vectorize/flags',   h: setVectorizeFlags, auth: 'admin' },

  // ── FAQ-candidate clustering (Phase 2b Silver) ──
  { m: 'POST', p: '/api/admin/faq-candidates/cluster', h: clusterFaqCandidates, auth: 'admin' },
  { m: 'GET',  p: '/api/admin/faq-candidates/clusters', h: listClusters, auth: 'admin' },
  { m: 'GET',  p: /^\/api\/admin\/faq-candidates\/clusters\/(\d+)\/members$/, h: clusterMembers, auth: 'admin', intParams: [0] },

  // ── Labels — reads = staff, writes = admin ──
  { m: 'GET',    p: '/api/labels', h: listLabels, auth: 'staff' },
  { m: 'POST',   p: '/api/labels', h: createLabel, auth: 'admin' },
  { m: 'PUT',    p: /^\/api\/labels\/(\d+)$/, h: updateLabel, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/labels\/(\d+)$/, h: deleteLabel, auth: 'admin', intParams: [0] },

  // ── FAQ — staff reads, admin writes (search is handled inline above) ──
  { m: 'GET',    p: '/api/faq', h: handleFaqGet, auth: 'staff' },
  { m: 'POST',   p: '/api/faq', h: handleFaqPost, auth: 'admin' },
  { m: 'GET',    p: /^\/api\/faq\/(\d+)$/, h: handleFaqGetOne, auth: 'staff', intParams: [0] },
  { m: 'PUT',    p: /^\/api\/faq\/(\d+)$/, h: handleFaqPut, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/faq\/(\d+)$/, h: handleFaqDelete, auth: 'admin', intParams: [0] },

  // ── Templates ──
  { m: 'GET',    p: '/api/templates', h: handleTemplatesGet, auth: 'staff' },
  { m: 'POST',   p: '/api/templates', h: handleTemplatesPost, auth: 'admin' },
  { m: 'PUT',    p: /^\/api\/templates\/(\d+)$/, h: handleTemplatesPut, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/templates\/(\d+)$/, h: handleTemplatesDelete, auth: 'admin', intParams: [0] },

  // ── Knowledge sources ──
  { m: 'GET',    p: '/api/knowledge-sources', h: handleKnowledgeSourcesGet, auth: 'staff' },
  { m: 'POST',   p: '/api/knowledge-sources', h: handleKnowledgeSourcesPost, auth: 'admin' },
  { m: 'GET',    p: /^\/api\/knowledge-sources\/(\d+)$/, h: handleKnowledgeSourcesGetOne, auth: 'staff', intParams: [0] },
  { m: 'PUT',    p: /^\/api\/knowledge-sources\/(\d+)$/, h: handleKnowledgeSourcesPut, auth: 'admin', intParams: [0] },
  { m: 'DELETE', p: /^\/api\/knowledge-sources\/(\d+)$/, h: handleKnowledgeSourcesDelete, auth: 'admin', intParams: [0] },

  // ── Pachi-slot proxy (admin browse + chat against upstream VPS API) ──
  // Previously these handlers were exported but never registered (Security
  // audit H-4, 2026-05-13). The /health/pachi probe at the top of fetch()
  // covers binding presence; these endpoints expose the underlying data.
  { m: 'GET',  p: '/api/pachi/search',  h: handlePachiSearch,    auth: 'staff' },
  { m: 'GET',  p: /^\/api\/pachi\/machines\/([^/]+)$/, h: handlePachiMachineGet, auth: 'staff' },
  { m: 'GET',  p: '/api/pachi/similar', h: handlePachiSimilar,   auth: 'staff' },
  { m: 'POST', p: '/api/pachi/chat',    h: handlePachiChat,      auth: 'staff' },
];
