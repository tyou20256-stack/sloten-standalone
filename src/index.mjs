// Sloten Standalone — Phase 1 Worker entry point.
// Self-contained chat backend (no Chatwoot).

import { buildCorsHeaders, handleCorsPreflight, isAllowedOrigin } from './cors-helper.mjs';
import { checkRateLimit, rateLimitResponse } from './rate-limiter.mjs';
import { ok, err } from './json.mjs';

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
import { uploadAttachment, downloadAttachment, downloadAttachmentSigned } from './handlers/attachments.mjs';
import { getPublicJackpot } from './handlers/public-jackpot.mjs';
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
// `requireAdmin` is deliberately removed — all routes now use either
// requireStaff (any authenticated staff) or requireAdminRole (admin only).

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

export default {
  async scheduled(event, env, ctx) {
    return handleScheduled(event, env, ctx);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const corsHeaders = buildCorsHeaders(request, env);

    if (method === 'OPTIONS') return handleCorsPreflight(request, env);

    try {
      // --- Public ---
      // Build / version info — useful for debug, ops dashboards, and rollback.
      // Fields:
      //   - worker_version: CF-injected hash of the deployed bundle (when available)
      //   - environment: var from wrangler.*.toml
      //   - api_provider: gemini|anthropic
      //   - has_anthropic_fallback: true when ANTHROPIC_API_KEY is set
      //   - cron_features: list of scheduled jobs that are wired up
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
      // Per-binding deep health (operational deep-dive endpoints).
      // Each returns 200 only when that binding is fully functional.
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
          // Vectorize doesn't have a cheap probe — describe is closest
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
        // Deep health: verify DB is reachable + check critical env presence.
        // Critical secrets: missing → degraded so dashboard alerts fire.
        // Optional secrets (Telegram, Anthropic): missing → reported but ok.
        const CRITICAL_SECRETS = ['GEMINI_API_KEY'];
        const CRITICAL_SIGNING_KEYS = ['SESSION_SIGNING_KEY', 'STAFF_SESSION_SIGNING_KEY'];
        const OPTIONAL = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY',
                          'BANK_TRANSFER_BOT_WEBHOOK_URL', 'GAS_BOT_WEBHOOK_URL',
                          'EC_DEPOSIT_BOT_WEBHOOK_URL', 'BONUS_CODE_WEBHOOK_URL',
                          'CONTACT_TOKEN_SIGNING_KEY', 'RAG_CACHE_SIGNING_KEY'];
        const missingCritical = CRITICAL_SECRETS.filter((k) => !env[k]);
        // For signing keys, treat ANY of them being present as ok (dual-verify pattern).
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
              critical_count: CRITICAL_SECRETS.length + 1, // +1 for signing key requirement
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
      if (path === '/widget' && method === 'GET') {
        return Response.redirect(new URL('/widget/', request.url).toString(), 302);
      }
      if (path === '/operator' && method === 'GET') {
        return Response.redirect(new URL('/operator/', request.url).toString(), 302);
      }
      if (path === '/admin' && method === 'GET') {
        return Response.redirect(new URL('/admin/', request.url).toString(), 302);
      }
      // Static assets — serve from ASSETS binding.
      if (env.ASSETS && (path.startsWith('/widget/') || path.startsWith('/operator/') || path.startsWith('/admin/') || path.startsWith('/shared/')) && method === 'GET') {
        const assetRes = await env.ASSETS.fetch(request);
        // Force browsers + CF edges to always revalidate widget/operator/admin
        // JS+CSS so bug fixes propagate within seconds, not hours. HTML is
        // already cache-busting via script src anyway; the extra revalidate
        // cost is trivial (304s from CF).
        if (assetRes.ok && /\.(m?js|css|html)$/.test(path)) {
          // Cache-control override (security headers come from public/_headers).
          const headers = new Headers(assetRes.headers);
          headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          headers.set('Pragma', 'no-cache');
          headers.set('Expires', '0');
          return new Response(assetRes.body, { status: assetRes.status, headers });
        }
        return assetRes;
      }

      // --- Staff auth (cookie-based) ---
      if (path === '/api/staff/login' && method === 'POST') {
        // IP-level rate limit to stop credential-stuffing across many accounts.
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `login:${ip}`, 10, 60, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
        return loginHandler(request, env, corsHeaders);
      }
      if (path === '/api/staff/logout' && method === 'POST') {
        // Soft CSRF guard: logout should not be forceable from another origin.
        if (!csrfCheck(request, env)) return err('CSRF: Origin/Sec-Fetch-Site rejected', 403, corsHeaders);
        return logoutHandler(request, env, corsHeaders);
      }
      if (path === '/api/staff/me' && method === 'GET') return meHandler(request, env, corsHeaders);

      // --- Attachments ---
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
      // Widget customer download: token-gated
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
      // Staff upload + download (admin console)
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)\/attachments$/);
        if (m && method === 'POST') return requireStaff(uploadAttachment)(request, env, corsHeaders, m[1], 'staff');
      }
      {
        const m = path.match(/^\/api\/attachments\/([^/]+)$/);
        if (m && method === 'GET') {
          // Signed URL (GAS/webhook caller) takes precedence over staff cookie.
          const u = new URL(request.url);
          if (u.searchParams.has('sig') && u.searchParams.has('exp')) {
            return downloadAttachmentSigned(request, env, corsHeaders, m[1]);
          }
          return requireStaff(downloadAttachment)(request, env, corsHeaders, m[1]);
        }
      }

      // --- WebSocket upgrade to ConversationRoom Durable Object ---
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

      // --- Widget-facing (public: contact create, conversation create, message send) ---
      // Rate-limited: 120 requests per minute per IP. Normal menu navigation
      // should never hit this; burst abuse still gets throttled quickly.
      if (method !== 'GET' && method !== 'OPTIONS' && path.startsWith('/api/widget/')) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `widget:${ip}`, 120, 60, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
      }

      // POST /api/widget/contacts is the only widget endpoint that doesn't
      // require a contact_token (because the caller doesn't have one yet).
      if (path === '/api/widget/contacts' && method === 'POST') return createContact(request, env, corsHeaders);

      // PATCH /api/widget/contacts/:id — runtime profile update (Chatwoot
      // `$chatwoot.setUser()` equivalent). Requires contact_token ownership.
      {
        const m = path.match(/^\/api\/widget\/contacts\/([^/]+)$/);
        if (m && method === 'PATCH') return updateContact(request, env, corsHeaders, m[1]);
      }

      // Helper: verify contact_token matches the conversation's contact_id.
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
          return getConversation(request, env, corsHeaders, m[1]);
        }
      }

      // --- Admin (Bearer auth) ---
      // Contacts
      if (path === '/api/contacts' && method === 'GET') return requireStaff(listContacts)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/contacts\/([^/]+)\/conversations$/);
        if (m && method === 'GET') return requireStaff(listContactConversations)(request, env, corsHeaders, m[1]);
      }
      {
        const m = path.match(/^\/api\/contacts\/([^/]+)$/);
        if (m && method === 'GET') return requireStaff(getContact)(request, env, corsHeaders, m[1]);
      }

      // Conversations (staff view)
      if (path === '/api/conversations' && method === 'GET') return requireStaff(listConversations)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)$/);
        if (m && method === 'GET') return requireStaff(getConversation)(request, env, corsHeaders, m[1]);
        if (m && method === 'PATCH') return requireStaff(updateConversation)(request, env, corsHeaders, m[1]);
      }
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        if (m && method === 'GET') return requireStaff(listMessages)(request, env, corsHeaders, m[1]);
        if (m && method === 'POST') return requireStaff(sendMessage)(request, env, corsHeaders, m[1], {}, ctx);
      }
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)\/mark_read$/);
        if (m && method === 'POST') return requireStaff(markRead)(request, env, corsHeaders, m[1]);
      }

      // Search (staff)
      if (path === '/api/search' && method === 'GET') return requireStaff(searchHandler)(request, env, corsHeaders);

      // Dashboard (staff)
      if (path === '/api/dashboard/stats' && method === 'GET') return requireStaff(dashboardStats)(request, env, corsHeaders);

      // Staff admin (admin role only, except self via /api/staff/me above)
      if (path === '/api/staff' && method === 'GET') return requireAdminRole(listStaff)(request, env, corsHeaders);
      // Directory lookup for any authenticated staff (id/name/role only, no secrets).
      if (path === '/api/staff/lookup' && method === 'GET') return requireStaff(listStaffLookup)(request, env, corsHeaders);
      if (path === '/api/staff' && method === 'POST') return requireAdminRole(createStaff)(request, env, corsHeaders);
      if (path === '/api/staff/import_from_chatwoot' && method === 'POST') return requireAdminRole(importStaffFromChatwoot)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/staff\/(\d+)$/);
        if (m && method === 'PATCH') return requireAdminRole(updateStaff)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteStaff)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/staff\/(\d+)\/reset_password$/);
        if (m && method === 'POST') return requireAdminRole(resetStaffPassword)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Export CSV (admin only)
      {
        const m = path.match(/^\/api\/export\/([a-z_]+)\.csv$/);
        if (m && method === 'GET') return requireAdminRole(exportCsv)(request, env, corsHeaders, m[1]);
      }

      // Teams — reads = any staff, writes = admin
      if (path === '/api/teams' && method === 'GET') return requireStaff(listTeams)(request, env, corsHeaders);
      if (path === '/api/teams' && method === 'POST') return requireAdminRole(createTeam)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/teams\/(\d+)$/);
        if (m && method === 'PATCH')  return requireAdminRole(updateTeam)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteTeam)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/teams\/(\d+)\/members$/);
        if (m && method === 'POST') return requireAdminRole(addTeamMember)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/teams\/(\d+)\/members\/(\d+)$/);
        if (m && method === 'DELETE') return requireAdminRole(removeTeamMember)(request, env, corsHeaders, parseInt(m[1], 10), parseInt(m[2], 10));
      }

      // FAQ candidates (weekly extraction review) — staff can read, admin acts
      if (path === '/api/faq-candidates' && method === 'GET') return requireStaff(listCandidates)(request, env, corsHeaders);
      if (path === '/api/faq-candidates/run' && method === 'POST') return requireAdminRole(runExtractionNow)(request, env, corsHeaders);
      if (path === '/api/faq-candidates/bulk' && method === 'POST') return requireAdminRole(bulkAction)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/faq-candidates\/(\d+)$/);
        if (m && method === 'PATCH') return requireAdminRole(updateCandidate)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/faq-candidates\/(\d+)\/approve$/);
        if (m && method === 'POST') return requireAdminRole(approveCandidate)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/faq-candidates\/(\d+)\/reject$/);
        if (m && method === 'POST') return requireAdminRole(rejectCandidate)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Bot flows (multi-step workflows; admin-role writes)
      if (path === '/api/bot-flows' && method === 'GET') return requireStaff(listBotFlows)(request, env, corsHeaders);
      if (path === '/api/bot-flows' && method === 'POST') return requireAdminRole(createBotFlow)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/bot-flows\/(\d+)$/);
        if (m && method === 'PATCH')  return requireAdminRole(updateBotFlow)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteBotFlow)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Bonus codes (admin-role writes; reads open to staff)
      if (path === '/api/bonus-codes' && method === 'GET') return requireStaff(listBonusCodes)(request, env, corsHeaders);
      if (path === '/api/bonus-codes' && method === 'POST') return requireAdminRole(createBonusCode)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/bonus-codes\/(\d+)$/);
        if (m && method === 'PATCH')  return requireAdminRole(updateBonusCode)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteBonusCode)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      if (path === '/api/bonus-code-submissions' && method === 'GET') return requireStaff(listBonusSubmissions)(request, env, corsHeaders);

      // Admin operations (admin-role): test webhook, GAS URL editor, ping,
      // audit/error logs, backup/restore. Mirrors production chatwoot-bot
      // admin "運用・監視" tab.
      if (path === '/api/admin/test-bot' && method === 'POST') return requireAdminRole((req, e, h) => adminTestBot(req, e, h, ctx))(request, env, corsHeaders);
      if (path === '/api/admin/gas-urls' && method === 'GET')  return requireAdminRole(listGasUrls)(request, env, corsHeaders);
      if (path === '/api/admin/gas-urls' && method === 'POST') return requireAdminRole(setGasUrl)(request, env, corsHeaders);
      if (path === '/api/admin/gas-ping' && method === 'POST') return requireAdminRole(pingGasUrl)(request, env, corsHeaders);
      if (path === '/api/admin/audit-log' && method === 'GET') return requireAdminRole(listAuditLog)(request, env, corsHeaders);
      if (path === '/api/admin/error-log' && method === 'GET') return requireAdminRole(listErrorLog)(request, env, corsHeaders);
      if (path === '/api/admin/backup' && method === 'GET')    return requireAdminRole(adminBackup)(request, env, corsHeaders);
      if (path === '/api/admin/restore' && method === 'POST')  return requireAdminRole(adminRestore)(request, env, corsHeaders);
      if (path === '/api/admin/menu-tree' && method === 'GET')  return requireStaff(adminMenuTree)(request, env, corsHeaders);
      if (path === '/api/admin/cache/flush'      && method === 'POST') return requireAdminRole(flushGenaiCache)(request, env, corsHeaders);
      if (path === '/api/admin/cache/flush-faq'  && method === 'POST') return requireAdminRole(flushFaqCache)(request, env, corsHeaders);
      if (path === '/api/admin/cache/stats'      && method === 'GET')  return requireAdminRole(cacheStats)(request, env, corsHeaders);

      // Bot menus (admin-role)
      if (path === '/api/bot-menus' && method === 'GET') return requireStaff(listBotMenus)(request, env, corsHeaders);
      if (path === '/api/bot-menus' && method === 'POST') return requireAdminRole(createBotMenu)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/bot-menus\/(\d+)$/);
        if (m && method === 'PATCH')  return requireAdminRole(updateBotMenu)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteBotMenu)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // AI prompts (admin-role)
      if (path === '/api/ai-prompts' && method === 'GET') return requireAdminRole(listPrompts)(request, env, corsHeaders);
      if (path === '/api/ai-prompts' && method === 'POST') return requireAdminRole(createPrompt)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/ai-prompts\/(\d+)$/);
        if (m && method === 'PATCH')  return requireAdminRole(updatePrompt)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deletePrompt)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // AI logs + feedback (admin only)
      if (path === '/api/ai-logs' && method === 'GET') return requireAdminRole(listAiLogs)(request, env, corsHeaders);
      if (path === '/api/ai-logs/stats' && method === 'GET') return requireAdminRole(aiStats)(request, env, corsHeaders);
      if (path === '/api/ai-logs/silent-failures' && method === 'GET') return requireAdminRole(listSilentFailures)(request, env, corsHeaders);

      // Phase 2: Golden Set CRUD + eval results + shadow mode settings
      if (path === '/api/golden-set' && method === 'GET')  return requireAdminRole(listGoldenSet)(request, env, corsHeaders);
      if (path === '/api/golden-set' && method === 'POST') return requireAdminRole(createGoldenRow)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/golden-set\/(\d+)$/);
        if (m && method === 'PATCH')  return requireAdminRole(updateGoldenRow)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteGoldenRow)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      if (path === '/api/golden-eval' && method === 'GET') return requireAdminRole(evalResults)(request, env, corsHeaders);
      if (path === '/api/admin/shadow-config' && method === 'GET')  return requireAdminRole(getShadowConfig)(request, env, corsHeaders);
      if (path === '/api/admin/shadow-config' && method === 'POST') return requireAdminRole(setShadowConfig)(request, env, corsHeaders);

      // Phase 2b: Vectorize reindex + query + state
      if (path === '/api/admin/vectorize/reindex' && method === 'POST') return requireAdminRole(vectorizeReindex)(request, env, corsHeaders);
      if (path === '/api/admin/vectorize/query'   && method === 'POST') return requireAdminRole(vectorizeQuery)(request, env, corsHeaders);
      if (path === '/api/admin/vectorize/state'   && method === 'GET')  return requireAdminRole(vectorizeState)(request, env, corsHeaders);
      if (path === '/api/admin/vectorize/flags'   && method === 'POST') return requireAdminRole(setVectorizeFlags)(request, env, corsHeaders);

      // Phase 2b: FAQ candidates Silver (clustering)
      if (path === '/api/admin/faq-candidates/cluster'  && method === 'POST') return requireAdminRole(clusterFaqCandidates)(request, env, corsHeaders);
      if (path === '/api/admin/faq-candidates/clusters' && method === 'GET')  return requireAdminRole(listClusters)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/admin\/faq-candidates\/clusters\/(\d+)\/members$/);
        if (m && method === 'GET') return requireAdminRole(clusterMembers)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/ai-logs\/(\d+)$/);
        if (m && method === 'GET') return requireAdminRole(getAiLog)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteAiLog)(request, env, corsHeaders, parseInt(m[1], 10));
      }
      {
        const m = path.match(/^\/api\/ai-logs\/(\d+)\/feedback$/);
        if (m && method === 'POST') return requireAdminRole(submitFeedback)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Labels — reads = any staff, writes = admin
      if (path === '/api/labels' && method === 'GET') return requireStaff(listLabels)(request, env, corsHeaders);
      if (path === '/api/labels' && method === 'POST') return requireAdminRole(createLabel)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/labels\/(\d+)$/);
        if (m && method === 'PUT')    return requireAdminRole(updateLabel)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(deleteLabel)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // FAQ — staff reads, admin writes. FAQ search stays public for widget.
      if (path === '/api/faq' && method === 'GET') return requireStaff(handleFaqGet)(request, env, corsHeaders);
      if (path === '/api/faq/search' && method === 'GET') {
        // Public but rate-limited.
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `faqsearch:${ip}`, 60, 60, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
        return handleFaqSearch(request, env, corsHeaders);
      }
      if (path === '/api/faq' && method === 'POST') return requireAdminRole(handleFaqPost)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/faq\/(\d+)$/);
        if (m && method === 'GET') return requireStaff(handleFaqGetOne)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'PUT') return requireAdminRole(handleFaqPut)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(handleFaqDelete)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Templates — staff reads, admin writes
      if (path === '/api/templates' && method === 'GET') return requireStaff(handleTemplatesGet)(request, env, corsHeaders);
      if (path === '/api/templates' && method === 'POST') return requireAdminRole(handleTemplatesPost)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/templates\/(\d+)$/);
        if (m && method === 'PUT') return requireAdminRole(handleTemplatesPut)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(handleTemplatesDelete)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Knowledge sources — staff reads (including :id), admin writes
      if (path === '/api/knowledge-sources' && method === 'GET') return requireStaff(handleKnowledgeSourcesGet)(request, env, corsHeaders);
      if (path === '/api/knowledge-sources' && method === 'POST') return requireAdminRole(handleKnowledgeSourcesPost)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/knowledge-sources\/(\d+)$/);
        if (m && method === 'GET') return requireStaff(handleKnowledgeSourcesGetOne)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'PUT') return requireAdminRole(handleKnowledgeSourcesPut)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdminRole(handleKnowledgeSourcesDelete)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      return err('Not Found', 404, corsHeaders);
    } catch (e) {
      console.error('[fetch]', e?.stack || e?.message || e);
      return err('Internal Server Error', 500, corsHeaders);
    }
  },
};
