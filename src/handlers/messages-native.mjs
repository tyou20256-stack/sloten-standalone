// Messages — standalone.
// Customer/staff/bot/system sender types; bot responses may be auto-generated
// via ai-chat-adapter when a customer message arrives on a status='bot' conversation.

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { generateBotReply } from '../ai-chat-adapter.mjs';

const VALID_SENDER = new Set(['customer', 'bot', 'staff', 'system']);
const VALID_CONTENT_TYPE = new Set(['text', 'input_select', 'file', 'system_event']);

async function insertMessage(env, { conversationId, tenantId, senderType, senderId, content, contentType, contentAttributes, isPrivate }) {
  const id = uuid();
  const attrs = contentAttributes ? JSON.stringify(contentAttributes) : null;
  await env.DB.prepare(
    `INSERT INTO messages (id, conversation_id, tenant_id, sender_type, sender_id, content, content_type, content_attributes, is_private)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, conversationId, tenantId, senderType, senderId || null, content, contentType, attrs, isPrivate ? 1 : 0).run();

  // Update conversation last_message_at + preview
  const preview = (content || '').slice(0, 200);
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(preview, conversationId).run();

  return env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
}

export async function sendMessage(request, env, corsHeaders, conversationId) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;

  const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
  if (!conv) return err('Conversation not found', 404, corsHeaders);

  const senderType = body.sender_type || 'customer';
  if (!VALID_SENDER.has(senderType)) return err('Invalid sender_type', 400, corsHeaders);
  const contentType = body.content_type || 'text';
  if (!VALID_CONTENT_TYPE.has(contentType)) return err('Invalid content_type', 400, corsHeaders);
  const content = (body.content || '').trim();
  if (!content && contentType === 'text') return err('content required', 400, corsHeaders);

  try {
    const msg = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType,
      senderId: body.sender_id,
      content,
      contentType,
      contentAttributes: body.content_attributes,
      isPrivate: body.is_private,
    });

    // Auto bot reply: customer message on bot-handled conversation
    let botReply = null;
    if (senderType === 'customer' && conv.status === 'bot') {
      try {
        const reply = await generateBotReply(env, {
          conversationId,
          tenantId: conv.tenant_id,
          customerMessage: content,
        });
        if (reply && reply.content) {
          botReply = await insertMessage(env, {
            conversationId,
            tenantId: conv.tenant_id,
            senderType: 'bot',
            senderId: null,
            content: reply.content,
            contentType: reply.content_type || 'text',
            contentAttributes: reply.content_attributes,
            isPrivate: false,
          });
        }
      } catch (e) {
        console.warn('[sendMessage] bot reply failed:', e.message);
      }
    }

    return created({ success: true, message: msg, bot_reply: botReply }, corsHeaders);
  } catch (e) {
    console.error('sendMessage:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function listMessages(request, env, corsHeaders, conversationId) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const includePrivate = url.searchParams.get('include_private') === '1';
  let q = 'SELECT * FROM messages WHERE conversation_id = ?';
  const vals = [conversationId];
  if (!includePrivate) q += ' AND is_private = 0';
  q += ' ORDER BY created_at ASC LIMIT ?';
  vals.push(limit);
  const { results } = await env.DB.prepare(q).bind(...vals).all();
  return ok({ success: true, messages: results || [] }, corsHeaders);
}
