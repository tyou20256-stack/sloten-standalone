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
  createContact, getContact, listContacts, listContactConversations,
} from './handlers/contacts-native.mjs';
import {
  createConversation, listConversations, getConversation, updateConversation, markRead,
} from './handlers/conversations-native.mjs';
import { searchHandler } from './handlers/search.mjs';
import { listLabels, createLabel, updateLabel, deleteLabel } from './handlers/labels.mjs';
import {
  listStaff, createStaff, updateStaff, deleteStaff, resetStaffPassword, importStaffFromChatwoot,
} from './handlers/staff-admin.mjs';
import { dashboardStats } from './handlers/dashboard.mjs';
import { exportCsv } from './handlers/export.mjs';
import { listAiLogs, getAiLog, deleteAiLog, submitFeedback, aiStats } from './handlers/ai-logs.mjs';
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
import { uploadAttachment, downloadAttachment, downloadAttachmentSigned } from './handlers/attachments.mjs';
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
      return handler(request, env, corsHeaders, ...rest);
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
      return handler(request, env, corsHeaders, ...rest);
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
      if (path === '/health' && method === 'GET') {
        return ok({ status: 'ok' }, corsHeaders);
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
      if (env.ASSETS && (path.startsWith('/widget/') || path.startsWith('/operator/') || path.startsWith('/admin/')) && method === 'GET') {
        return env.ASSETS.fetch(request);
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
      // Rate-limited: 30 req / 10 min per IP for widget writes.
      if (method !== 'GET' && method !== 'OPTIONS' && path.startsWith('/api/widget/')) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `widget:${ip}`, 30, 600, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
      }

      // POST /api/widget/contacts is the only widget endpoint that doesn't
      // require a contact_token (because the caller doesn't have one yet).
      if (path === '/api/widget/contacts' && method === 'POST') return createContact(request, env, corsHeaders);

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
