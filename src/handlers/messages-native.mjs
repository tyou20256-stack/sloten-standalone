// Messages — standalone.
// Customer/staff/bot/system sender types; bot responses may be auto-generated
// via ai-chat-adapter when a customer message arrives on a status='bot' conversation.

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { generateBotReply } from '../ai-chat-adapter.mjs';
import { broadcastToConversation } from '../broadcast.mjs';
import { checkRateLimit, rateLimitResponse } from '../rate-limiter.mjs';
import { runFlowForCustomerMessage } from './bot-flows.mjs';

const VALID_SENDER = new Set(['customer', 'bot', 'staff', 'system']);
const VALID_CONTENT_TYPE = new Set(['text', 'input_select', 'file', 'system_event']);

async function insertMessage(env, { conversationId, tenantId, senderType, senderId, content, contentType, contentAttributes, isPrivate }) {
  const id = uuid();
  const attrs = contentAttributes ? JSON.stringify(contentAttributes) : null;
  const priv = isPrivate ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO messages (id, conversation_id, tenant_id, sender_type, sender_id, content, content_type, content_attributes, is_private)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, conversationId, tenantId, senderType, senderId || null, content, contentType, attrs, priv).run();

  // Update conversation metadata. Private messages don't bump last_message_preview
  // (preview is visible to customer via widget resume loadHistory).
  // Staff unread increments when the message was authored by customer or bot —
  // i.e. something staff might want to react to.
  const preview = (content || '').slice(0, 200);
  const bumpUnread = (senderType === 'customer' || senderType === 'bot') && !priv ? 1 : 0;
  if (priv) {
    // Private: only update updated_at
    await env.DB.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`)
      .bind(conversationId).run();
  } else {
    await env.DB.prepare(
      `UPDATE conversations
          SET last_message_at = datetime('now'),
              last_message_preview = ?,
              unread_count_staff = unread_count_staff + ?,
              updated_at = datetime('now')
        WHERE id = ?`
    ).bind(preview, bumpUnread, conversationId).run();
  }

  const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();

  // Broadcast: private notes go to operator peers only (customer widget filters
  // is_private=1 client-side via include_private=0 query; over WS we must not
  // deliver them to customer connections. Simplification for Phase 2-7: broadcast
  // to the room and let the widget JS drop any frame where is_private=1).
  try {
    await broadcastToConversation(env, conversationId, {
      type: 'message.created',
      message: row,
    });
  } catch (_) { /* swallow */ }

  return row;
}

export async function sendMessage(request, env, corsHeaders, conversationId, opts = {}, ctx = undefined) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;

  const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
  if (!conv) return err('Conversation not found', 404, corsHeaders);

  // Widget path: force customer sender and non-private regardless of body.
  const isWidget = opts.source === 'widget';
  const senderType = isWidget ? 'customer' : (body.sender_type || 'customer');
  if (!VALID_SENDER.has(senderType)) return err('Invalid sender_type', 400, corsHeaders);
  const contentType = body.content_type || 'text';
  if (!VALID_CONTENT_TYPE.has(contentType)) return err('Invalid content_type', 400, corsHeaders);
  const content = (body.content || '').trim();
  if (!content && contentType === 'text') return err('content required', 400, corsHeaders);
  const forcePrivate = isWidget ? false : !!body.is_private;

  try {
    const msg = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType,
      senderId: isWidget ? null : body.sender_id,
      content,
      contentType,
      contentAttributes: isWidget ? null : body.content_attributes,
      isPrivate: forcePrivate,
    });

    // Auto bot reply: customer message on bot-handled conversation.
    // Priority:
    //   1. Active multi-step flow (or a new flow triggered by the message)
    //   2. Static keyword menu (in ai-chat-adapter)
    //   3. LLM reply
    let botReply = null;
    const botReplies = [];
    if (senderType === 'customer' && conv.status === 'bot') {
      try {
        // Reload conv with flow_state column after our UPDATE above.
        const fresh = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
        const contact = fresh?.contact_id ? await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(fresh.contact_id).first() : null;
        const flowResult = await runFlowForCustomerMessage(env, fresh, contact, content, ctx);
        if (flowResult.messages && flowResult.messages.length) {
          for (const m of flowResult.messages) {
            const botMsg = await insertMessage(env, {
              conversationId,
              tenantId: conv.tenant_id,
              senderType: 'bot', senderId: null,
              content: m.content,
              contentType: m.content_type || 'text',
              contentAttributes: m.content_attributes || null,
              isPrivate: false,
            });
            botReplies.push(botMsg);
          }
          botReply = botReplies[botReplies.length - 1] || null;
        } else {
          // No flow active — fall back to AI chat.
          const reply = await generateBotReply(env, {
            conversationId,
            tenantId: conv.tenant_id,
            customerMessage: content,
            ctx,
          });
          if (reply && reply.content) {
            botReply = await insertMessage(env, {
              conversationId,
              tenantId: conv.tenant_id,
              senderType: 'bot', senderId: null,
              content: reply.content,
              contentType: reply.content_type || 'text',
              contentAttributes: reply.content_attributes,
              isPrivate: false,
            });
            botReplies.push(botReply);
          }
        }
      } catch (e) {
        console.warn('[sendMessage] bot reply failed:', e.message, e.stack);
      }
    }

    return created({ success: true, message: msg, bot_reply: botReply, bot_replies: botReplies }, corsHeaders);
  } catch (e) {
    console.error('sendMessage:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function listMessages(request, env, corsHeaders, conversationId, opts = {}) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  // Widget callers are never shown private notes, regardless of query.
  const includePrivate = opts.source === 'widget' ? false : (url.searchParams.get('include_private') === '1');
  let q = 'SELECT * FROM messages WHERE conversation_id = ?';
  const vals = [conversationId];
  if (!includePrivate) q += ' AND is_private = 0';
  q += ' ORDER BY created_at ASC LIMIT ?';
  vals.push(limit);
  const { results } = await env.DB.prepare(q).bind(...vals).all();
  return ok({ success: true, messages: results || [] }, corsHeaders);
}
