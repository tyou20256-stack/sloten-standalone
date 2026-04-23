// Messages — standalone.
// Customer/staff/bot/system sender types; bot responses may be auto-generated
// via ai-chat-adapter when a customer message arrives on a status='bot' conversation.

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { generateBotReply } from '../ai-chat-adapter.mjs';
import { broadcastToConversation } from '../broadcast.mjs';
import { checkRateLimit, rateLimitResponse } from '../rate-limiter.mjs';
import { runFlowForCustomerMessage } from './bot-flows.mjs';
import { linkAttachmentToMessage, fetchAttachmentsForMessages } from './attachments.mjs';
import { signAttachmentUrl, baseUrlOf } from '../auth/attachment-signature.mjs';
import { matchBonusCode, getBonusReply, recordSubmission, forwardToGas } from '../bonus-codes.mjs';
import { decideEscalation } from '../escalation.mjs';
import { recordAiCall } from './ai-logs.mjs';
import { maskPII } from '../pii-masker.mjs';
import { logError } from '../audit.mjs';

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
    // Allow customers/staff to attach a pre-uploaded file by id. For widget,
    // only attachment_id is accepted from body.content_attributes (everything
    // else is ignored).
    let contentAttributes = isWidget ? null : body.content_attributes;
    const attachmentId = isWidget
      ? (body.content_attributes && body.content_attributes.attachment_id ? String(body.content_attributes.attachment_id) : null)
      : (contentAttributes?.attachment_id ? String(contentAttributes.attachment_id) : null);
    if (attachmentId) {
      const att = await env.DB.prepare('SELECT id, conversation_id FROM attachments WHERE id = ?').bind(attachmentId).first();
      if (!att || att.conversation_id !== conversationId) {
        return err('Invalid attachment_id', 400, corsHeaders);
      }
      contentAttributes = { ...(contentAttributes || {}), attachment_id: attachmentId };
    }

    const msg = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType,
      senderId: isWidget ? null : body.sender_id,
      content,
      contentType,
      contentAttributes,
      isPrivate: forcePrivate,
    });
    if (attachmentId) {
      await linkAttachmentToMessage(env, attachmentId, msg.id, conversationId);
    }

    // Webhook dispatch: operator sends a non-private message with an
    // attachment -> notify external system (GAS etc.) with a signed URL.
    if (
      !isWidget && senderType === 'staff' && attachmentId && !forcePrivate
      && await (await import('../env-resolver.mjs')).getEnvValue(env, 'OPERATOR_ATTACHMENT_WEBHOOK_URL')
    ) {
      const sendWebhook = async () => {
        try {
          const att = await env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(attachmentId).first();
          if (!att) return;
          const contact = conv.contact_id
            ? await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(conv.contact_id).first()
            : null;
          const staff = body.sender_id
            ? await env.DB.prepare('SELECT id, email, name, role FROM staff_members WHERE id = ?').bind(body.sender_id).first()
            : (request.__staff ? { id: request.__staff.id, email: request.__staff.email, name: request.__staff.name, role: request.__staff.role } : null);
          const signedUrl = await signAttachmentUrl(env, attachmentId, baseUrlOf(request, env));
          const payload = {
            event: 'operator.attachment_sent',
            conversation_id: conversationId,
            contact: contact
              ? { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, metadata: contact.metadata ? JSON.parse(contact.metadata) : null }
              : null,
            staff,
            message: { id: msg.id, content: msg.content, created_at: msg.created_at, is_private: !!msg.is_private },
            attachment: {
              id: att.id, filename: att.filename, content_type: att.content_type,
              size_bytes: att.size_bytes, checksum_sha256: att.checksum_sha256,
              url: signedUrl,
            },
          };
          const r = await fetch(await (await import('../env-resolver.mjs')).getEnvValue(env, 'OPERATOR_ATTACHMENT_WEBHOOK_URL'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!r.ok) console.warn('[attachment-webhook] non-2xx:', r.status);
        } catch (e) {
          console.warn('[attachment-webhook] failed:', e.message);
        }
      };
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sendWebhook());
      else sendWebhook().catch(() => {});
    }

    // Widget-initiated flow reset: the 'メニュー' button sends {reset_flow:true}
    // to clear any active flow_state and re-enter the main menu.
    if (isWidget && body.reset_flow === true) {
      await env.DB.prepare(`UPDATE conversations SET flow_state = NULL, updated_at = datetime('now') WHERE id = ?`)
        .bind(conversationId).run();
    }

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

        // 0. Escalation gate (Phase 1+2) — hard keywords / RG / anger / sentiment /
        //    dead-loop trigger immediate handoff regardless of flow state or
        //    bonus code match. Dead-loop detection needs the last 3 customer
        //    messages, so we fetch them here (cheap — indexed query on
        //    conversation_id + created_at).
        let escHistory = [];
        try {
          const { results } = await env.DB.prepare(
            `SELECT sender_type, content FROM messages
              WHERE conversation_id = ? AND sender_type = 'customer'
              ORDER BY created_at DESC LIMIT 5`,
          ).bind(conversationId).all();
          escHistory = (results || []).reverse();
        } catch (_) { /* best-effort */ }
        const escalation = decideEscalation(content, escHistory);
        if (escalation.shouldEscalate) {
          // Clear any flow_state so the operator starts from a clean slate.
          if (fresh.flow_state) {
            await env.DB.prepare(
              `UPDATE conversations SET flow_state=NULL, status='open', updated_at=datetime('now') WHERE id=?`,
            ).bind(conversationId).run();
          } else {
            await env.DB.prepare(
              `UPDATE conversations SET status='open', updated_at=datetime('now') WHERE id=?`,
            ).bind(conversationId).run();
          }
          const botMsg = await insertMessage(env, {
            conversationId,
            tenantId: conv.tenant_id,
            senderType: 'bot', senderId: null,
            content: escalation.responseText,
            contentType: 'text',
            contentAttributes: null,
            isPrivate: false,
          });
          botReplies.push(botMsg);
          // Log the escalation decision for audit (best-effort).
          const logPromise = recordAiCall(env, {
            tenant_id: conv.tenant_id,
            conversation_id: conversationId,
            provider: 'n/a',
            model: 'escalation',
            system_prompt: 'escalation-gate',
            input: maskPII(content),
            output: escalation.responseText,
            latency_ms: 0,
            status: 'escalated',
            escalation_reason: escalation.reason,
          });
          if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(logPromise);
          else await logPromise;
          return created({ success: true, message: msg, bot_reply: botMsg, bot_replies: botReplies }, corsHeaders);
        }

        // 1. Bonus code match — highest priority. Runs even when inside a
        //    flow, because customers are told to "type bonus codes directly
        //    in the chat" even from the menu (see bonus_code_request step).
        //    We suppress bonus matching only when the customer is inside a
        //    deposit sub-flow collecting money — there, their inputs are
        //    amounts/IDs and must not be eaten by a coincidentally-matching
        //    code.
        const inDepositFlow = fresh.flow_state && (() => {
          try {
            const st = JSON.parse(fresh.flow_state);
            return typeof st.step_id === 'string' && (
              st.step_id.startsWith('paypay_money') ||
              st.step_id.startsWith('bank_transfer') ||
              st.step_id.startsWith('convenience_store_deposit')
            );
          } catch { return false; }
        })();
        if (!inDepositFlow) {
          const match = await matchBonusCode(env, conv.tenant_id, content);
          if (match.matched) {
            // Determine whether this bonus code has follow-up buttons that
            // need flow re-entry (has_balance / game selection / plan choice).
            // If so, set flow_state to the bridge select step so the next
            // button click routes correctly. Otherwise clear flow_state.
            const bridgeStepId = `bonus_select_${match.row.type_key}`;
            const slotenMain = await env.DB.prepare(
              `SELECT id FROM bot_flows WHERE tenant_id = ? AND name = 'sloten-main' AND is_active = 1 LIMIT 1`,
            ).bind(conv.tenant_id).first();
            // Check if bridge step actually exists in the flow.
            let hasBridge = false;
            if (slotenMain) {
              try {
                const flowRow = await env.DB.prepare('SELECT steps FROM bot_flows WHERE id = ?').bind(slotenMain.id).first();
                const flowSteps = JSON.parse(flowRow?.steps || '[]');
                hasBridge = flowSteps.some((s) => s.id === bridgeStepId);
              } catch (_) {}
            }
            if (hasBridge && slotenMain) {
              // Set flow_state to the bridge step so the next customer click
              // enters the flow at the right position.
              const bridgeState = JSON.stringify({ flow_id: slotenMain.id, step_id: bridgeStepId, vars: {} });
              await env.DB.prepare(
                `UPDATE conversations SET flow_state=?, updated_at=datetime('now') WHERE id=?`,
              ).bind(bridgeState, conversationId).run();
            } else if (fresh.flow_state) {
              // No bridge — clear flow state (original behavior for codes
              // whose items are just welcome_message / transfer_to_agent).
              await env.DB.prepare(
                `UPDATE conversations SET flow_state=NULL, updated_at=datetime('now') WHERE id=?`,
              ).bind(conversationId).run();
            }
            const reply = getBonusReply(match.row);
            if (reply && reply.content) {
              const botMsg = await insertMessage(env, {
                conversationId,
                tenantId: conv.tenant_id,
                senderType: 'bot', senderId: null,
                content: reply.content,
                contentType: reply.items.length ? 'input_select' : 'text',
                contentAttributes: reply.items.length ? { items: reply.items } : null,
                isPrivate: false,
              });
              botReplies.push(botMsg);
              botReply = botMsg;
            }
            const submissionId = await recordSubmission(env, {
              tenantId: conv.tenant_id,
              conversationId,
              contactId: fresh.contact_id,
              match,
              code: match.code,
            });
            await forwardToGas(env, ctx, { submissionId, match, conversationId, contact });
            if (match.row.transfer_after) {
              await env.DB.prepare(
                `UPDATE conversations SET status='open', updated_at=datetime('now') WHERE id=?`,
              ).bind(conversationId).run();
            }
            return created({ success: true, message: msg, bot_reply: botReply, bot_replies: botReplies }, corsHeaders);
          }
        }

        const flowResult = await runFlowForCustomerMessage(env, fresh, contact, content, ctx, contentAttributes);
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
          // Load last 6 messages as escalation history (for dead-loop detection).
          let history = [];
          try {
            const { results } = await env.DB.prepare(
              `SELECT sender_type, content FROM messages
                WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 6`,
            ).bind(conversationId).all();
            history = (results || []).reverse();
          } catch (_) { /* best-effort */ }

          const reply = await generateBotReply(env, {
            conversationId,
            tenantId: conv.tenant_id,
            customerMessage: content,
            ctx,
            history,
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
            // Phase 1: if AI decided escalation, flip conversation to open so
            // operators pick it up immediately.
            if (reply.handoff) {
              await env.DB.prepare(
                `UPDATE conversations SET status='open', updated_at=datetime('now') WHERE id=?`,
              ).bind(conversationId).run();
            }
          }
        }
      } catch (e) {
        console.warn('[sendMessage] bot reply failed:', e.message, e.stack);
        logError(env, 'sendMessage:botReply', e, { conversation_id: conversationId }).catch(() => {});
      }
    }

    return created({ success: true, message: msg, bot_reply: botReply, bot_replies: botReplies }, corsHeaders);
  } catch (e) {
    console.error('sendMessage:', e.message);
    logError(env, 'sendMessage', e, { conversation_id: conversationId }).catch(() => {});
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
  // Decorate messages with attachment metadata when an attachment_id is
  // present in content_attributes — clients can then preview via the
  // widget/staff download endpoints.
  const decorated = await fetchAttachmentsForMessages(env, results || []);
  return ok({ success: true, messages: decorated }, corsHeaders);
}
