// Sloten Standalone — Phase 1 Worker entry point.
// Self-contained chat backend (no Chatwoot).

import { buildCorsHeaders, handleCorsPreflight } from './cors-helper.mjs';
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
  createContact, getContact, listContacts,
} from './handlers/contacts-native.mjs';
import {
  createConversation, listConversations, getConversation, updateConversation,
} from './handlers/conversations-native.mjs';
import {
  sendMessage, listMessages,
} from './handlers/messages-native.mjs';

function bearerAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  return env.ADMIN_API_TOKEN && m[1] === env.ADMIN_API_TOKEN;
}

function requireAdmin(handler) {
  return async (request, env, corsHeaders, ...rest) => {
    if (!bearerAuth(request, env)) return err('Unauthorized', 401, corsHeaders);
    return handler(request, env, corsHeaders, ...rest);
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const corsHeaders = buildCorsHeaders(request, env);

    if (method === 'OPTIONS') return handleCorsPreflight(request, env);

    try {
      // --- Public ---
      if (path === '/health' && method === 'GET') {
        return ok({ status: 'ok', environment: env.ENVIRONMENT, provider: env.AI_PROVIDER }, corsHeaders);
      }

      // --- Widget-facing (public: contact create, conversation create, message send) ---
      // Rate-limited: 30 req / 10 min per IP for widget writes.
      if (method !== 'GET' && method !== 'OPTIONS' && path.startsWith('/api/widget/')) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const check = await checkRateLimit(env, `widget:${ip}`, 30, 600, ctx);
        if (!check.allowed) return rateLimitResponse(check, corsHeaders);
      }

      if (path === '/api/widget/contacts' && method === 'POST') return createContact(request, env, corsHeaders);
      if (path === '/api/widget/conversations' && method === 'POST') return createConversation(request, env, corsHeaders);

      {
        const m = path.match(/^\/api\/widget\/conversations\/([^/]+)\/messages$/);
        if (m && method === 'POST') return sendMessage(request, env, corsHeaders, m[1]);
        if (m && method === 'GET') return listMessages(request, env, corsHeaders, m[1]);
      }
      {
        const m = path.match(/^\/api\/widget\/conversations\/([^/]+)$/);
        if (m && method === 'GET') return getConversation(request, env, corsHeaders, m[1]);
      }

      // --- Admin (Bearer auth) ---
      // Contacts
      if (path === '/api/contacts' && method === 'GET') return requireAdmin(listContacts)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/contacts\/([^/]+)$/);
        if (m && method === 'GET') return requireAdmin(getContact)(request, env, corsHeaders, m[1]);
      }

      // Conversations (admin view)
      if (path === '/api/conversations' && method === 'GET') return requireAdmin(listConversations)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)$/);
        if (m && method === 'GET') return requireAdmin(getConversation)(request, env, corsHeaders, m[1]);
        if (m && method === 'PATCH') return requireAdmin(updateConversation)(request, env, corsHeaders, m[1]);
      }
      {
        const m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        if (m && method === 'GET') return requireAdmin(listMessages)(request, env, corsHeaders, m[1]);
        if (m && method === 'POST') return requireAdmin(sendMessage)(request, env, corsHeaders, m[1]);
      }

      // FAQ
      if (path === '/api/faq' && method === 'GET') return handleFaqGet(request, env, corsHeaders);
      if (path === '/api/faq/search' && method === 'GET') return handleFaqSearch(request, env, corsHeaders);
      if (path === '/api/faq' && method === 'POST') return requireAdmin(handleFaqPost)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/faq\/(\d+)$/);
        if (m && method === 'GET') return handleFaqGetOne(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'PUT') return requireAdmin(handleFaqPut)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdmin(handleFaqDelete)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Templates
      if (path === '/api/templates' && method === 'GET') return requireAdmin(handleTemplatesGet)(request, env, corsHeaders);
      if (path === '/api/templates' && method === 'POST') return requireAdmin(handleTemplatesPost)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/templates\/(\d+)$/);
        if (m && method === 'PUT') return requireAdmin(handleTemplatesPut)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdmin(handleTemplatesDelete)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      // Knowledge sources
      if (path === '/api/knowledge-sources' && method === 'GET') return requireAdmin(handleKnowledgeSourcesGet)(request, env, corsHeaders);
      if (path === '/api/knowledge-sources' && method === 'POST') return requireAdmin(handleKnowledgeSourcesPost)(request, env, corsHeaders);
      {
        const m = path.match(/^\/api\/knowledge-sources\/(\d+)$/);
        if (m && method === 'GET') return handleKnowledgeSourcesGetOne(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'PUT') return requireAdmin(handleKnowledgeSourcesPut)(request, env, corsHeaders, parseInt(m[1], 10));
        if (m && method === 'DELETE') return requireAdmin(handleKnowledgeSourcesDelete)(request, env, corsHeaders, parseInt(m[1], 10));
      }

      return err('Not Found', 404, corsHeaders);
    } catch (e) {
      console.error('[fetch]', e?.stack || e?.message || e);
      return err('Internal Server Error', 500, corsHeaders);
    }
  },
};
