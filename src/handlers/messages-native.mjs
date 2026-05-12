// Messages — standalone.
// Customer/staff/bot/system sender types; bot responses may be auto-generated
// via ai-chat-adapter when a customer message arrives on a status='bot' conversation.

import { uuid } from '../id.mjs';
import { ok, created, err, parseJson } from '../json.mjs';
import { generateBotReply } from '../ai-chat-adapter.mjs';
import { broadcastToConversation } from '../broadcast.mjs';
import { checkRateLimit, rateLimitResponse } from '../rate-limiter.mjs';
import { runFlowForCustomerMessage, executeFlow } from './bot-flows.mjs';
import { buildMenuTreeText, inferJumpTarget } from '../lib/menu-tree.mjs';
import { linkAttachmentToMessage, fetchAttachmentsForMessages } from './attachments.mjs';
import { signAttachmentUrl, baseUrlOf } from '../auth/attachment-signature.mjs';
import { matchBonusCode, getBonusReply, recordSubmission, forwardToGas } from '../bonus-codes.mjs';
import { decideEscalation } from '../escalation.mjs';
import { detectAnnouncementQuery } from './announcements.mjs';
import { recordAiCall } from './ai-logs.mjs';
import { maskPII } from '../pii-masker.mjs';
import { logError } from '../audit.mjs';
import { bestEffortSync } from '../lib/best-effort.mjs';

const VALID_SENDER = new Set(['customer', 'bot', 'staff', 'system']);
const VALID_CONTENT_TYPE = new Set(['text', 'input_select', 'file', 'system_event']);

async function insertMessage(env, { conversationId, tenantId, senderType, senderId, content, contentType, contentAttributes, isPrivate }, ctx = undefined) {
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

  // Broadcast via Durable Object — best-effort and OFF the request critical
  // path. Previously this was awaited inline, adding ~300-500ms per message
  // (DO cold-start). With ctx.waitUntil it runs after the HTTP response is
  // sent, dropping bot-reply latency by ~600-1000ms (2 inserts per request).
  // Without ctx (e.g. unit tests) we still fire-and-forget without await.
  const broadcastTask = broadcastToConversation(env, conversationId, {
    type: 'message.created',
    message: row,
  }).catch(() => { /* swallow — broadcasts must never fail the response */ });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(broadcastTask);

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
  let content = (body.content || '').trim();
  if (!content && contentType === 'text') return err('content required', 400, corsHeaders);
  // Hard cap message length — prevents ReDoS via long inputs in
  // responseFilter / pachi detection regex, and bounds LLM token cost.
  // 4000 chars covers any realistic CS question; pasted logs / spam exceed it.
  const MAX_CONTENT_CHARS = 4000;
  if (content.length > MAX_CONTENT_CHARS) {
    if (isWidget) return err('content too long (max 4000 chars)', 413, corsHeaders);
    content = content.slice(0, MAX_CONTENT_CHARS);
  }
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
    }, ctx);
    if (attachmentId) {
      await linkAttachmentToMessage(env, attachmentId, msg.id, conversationId);
    }

    // Operator attachment webhook — fire-and-forget via ctx.waitUntil.
    await maybeDispatchAttachmentWebhook(env, ctx, request, {
      conv, msg, attachmentId, body, isWidget, senderType, forcePrivate, conversationId,
    });

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

    // (a) Escalated-conversation continuity (mt-004 fix, 2026-05-08):
    // After handoff, subsequent customer messages used to receive total
    // silence. Reply with a brief ack so the customer knows the human
    // operator will see it.
    if (senderType === 'customer' && conv.status === 'open') {
      await insertEscalatedAck(env, ctx, conv, conversationId, botReplies);
    }

    // (b) Bot pipeline: only when the conversation is bot-handled and the
    // sender is the customer. Pipeline stages each return a Response or null;
    // the first non-null short-circuits the rest.
    if (senderType === 'customer' && conv.status === 'bot') {
      try {
        const fresh = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
        const contact = fresh?.contact_id
          ? await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(fresh.contact_id).first()
          : null;

        const ctxArgs = { conv, fresh, contact, conversationId, content, contentAttributes, msg, corsHeaders, botReplies, ctx };

        const escResp = await tryEscalationGate(env, ctxArgs);
        if (escResp) return escResp;

        const bonusResp = await tryBonusCodeMatch(env, ctxArgs);
        if (bonusResp) return bonusResp;

        const flowResp = await runFlowOrAi(env, ctxArgs);
        if (flowResp) return flowResp;

        botReply = botReplies[botReplies.length - 1] || null;
      } catch (e) {
        console.warn('[sendMessage] bot reply failed:', e.message, e.stack);
        logError(env, 'sendMessage:botReply', e, { conversation_id: conversationId }).catch(() => {});
        // Silent-failure guard: when generateBotReply throws (Gemini API error,
        // empty text with status='error', etc.) the user previously saw NO bot
        // reply at all because bot_replies stayed []. Always insert a fallback
        // text so the widget renders something actionable.
        if (botReplies.length === 0) {
          botReply = await insertBotErrorFallback(env, ctx, conv, conversationId, botReplies);
        }
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

// ─── sendMessage internals ──────────────────────────────────────────
// The sendMessage flow has three observable stages once a customer message
// lands on a bot-handled conversation:
//   1. Escalation gate — hard keywords / RG / anger / dead-loop trigger handoff.
//   2. Bonus code match — codes intercepted before the flow engine.
//   3. Flow / AI fallback — runFlowForCustomerMessage drives the menu, with an
//      AI-fallback path when the customer types free text on a select step.
// Each helper returns either:
//   - a `Response` to short-circuit (terminates the request); or
//   - `null` to continue to the next stage.
//
// All helpers share a `ctxArgs` bag of: { conv, fresh, contact, conversationId,
// content, contentAttributes, msg, corsHeaders, botReplies, ctx }.
// They push to `botReplies` for accumulation.

async function maybeDispatchAttachmentWebhook(env, ctx, request, args) {
  const { conv, msg, attachmentId, body, isWidget, senderType, forcePrivate, conversationId } = args;
  if (isWidget || senderType !== 'staff' || !attachmentId || forcePrivate) return;
  const webhookUrl = await (await import('../env-resolver.mjs')).getEnvValue(env, 'OPERATOR_ATTACHMENT_WEBHOOK_URL');
  if (!webhookUrl) return;

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
      const signedUrl = await signAttachmentUrl(env, attachmentId, baseUrlOf(request, env), undefined, conversationId);
      const payload = {
        event: 'operator.attachment_sent',
        conversation_id: conversationId,
        contact: contact
          ? {
              id: contact.id,
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              metadata: contact.metadata
                ? bestEffortSync('messages:attachment-payload:metadata', () => JSON.parse(contact.metadata))
                : null,
            }
          : null,
        staff,
        message: { id: msg.id, content: msg.content, created_at: msg.created_at, is_private: !!msg.is_private },
        attachment: {
          id: att.id, filename: att.filename, content_type: att.content_type,
          size_bytes: att.size_bytes, checksum_sha256: att.checksum_sha256,
          url: signedUrl,
        },
      };
      const r = await fetch(webhookUrl, {
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

async function insertEscalatedAck(env, ctx, conv, conversationId, botReplies) {
  try {
    const ackMsg = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType: 'bot', senderId: null,
      content: 'お問い合わせを受け付けました。担当者がご対応中ですので、引き続きお待ちくださいませ。',
      contentType: 'text', contentAttributes: null, isPrivate: false,
    }, ctx);
    botReplies.push(ackMsg);
  } catch (_) { /* best-effort acknowledgment */ }
}

async function insertBotErrorFallback(env, ctx, conv, conversationId, botReplies) {
  try {
    const fallback = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType: 'bot', senderId: null,
      content: 'ご質問内容の処理中にエラーが発生しました。お手数ですが、もう一度ご質問いただくか、下のメニューからお選びください。',
      contentType: 'text',
      contentAttributes: null,
      isPrivate: false,
    }, ctx);
    botReplies.push(fallback);
    return fallback;
  } catch (insertErr) {
    console.warn('[sendMessage] fallback insert also failed:', insertErr.message);
    return null;
  }
}

// Stage 1: hard escalation gate. Returns a 201 Response when the conversation
// is handed off (and the customer message is acked), otherwise null.
async function tryEscalationGate(env, ctxArgs) {
  const { conv, fresh, conversationId, content, msg, corsHeaders, botReplies, ctx } = ctxArgs;
  // Dead-loop detection needs the last 5 customer messages — cheap indexed query.
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
  if (!escalation.shouldEscalate) return null;

  // Clear flow_state so the operator starts from a clean slate; flip status open.
  await env.DB.prepare(
    fresh.flow_state
      ? `UPDATE conversations SET flow_state=NULL, status='open', updated_at=datetime('now') WHERE id=?`
      : `UPDATE conversations SET status='open', updated_at=datetime('now') WHERE id=?`,
  ).bind(conversationId).run();

  const botMsg = await insertMessage(env, {
    conversationId,
    tenantId: conv.tenant_id,
    senderType: 'bot', senderId: null,
    content: escalation.responseText,
    contentType: 'text',
    contentAttributes: null,
    isPrivate: false,
  }, ctx);
  botReplies.push(botMsg);

  // Audit log — ctx.waitUntil keeps the INSERT off the response critical path.
  const escalationLog = recordAiCall(env, {
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
  }, ctx);
  if (!ctx || typeof ctx.waitUntil !== 'function') await escalationLog.promise;
  return created({ success: true, message: msg, bot_reply: botMsg, bot_replies: botReplies }, corsHeaders);
}

// Stage 2: bonus code match. Returns 201 Response when a code matches and the
// bonus reply is delivered, otherwise null.
async function tryBonusCodeMatch(env, ctxArgs) {
  const { conv, fresh, contact, conversationId, content, msg, corsHeaders, botReplies, ctx } = ctxArgs;

  // Suppress matching while inside a deposit sub-flow — inputs there are
  // amounts/IDs and must not be eaten by a coincidentally-matching code.
  const inDepositFlow = fresh.flow_state && (() => {
    const st = bestEffortSync('messages:inDepositFlow:state',
      () => JSON.parse(fresh.flow_state));
    return !!(st && typeof st.step_id === 'string' && (
      st.step_id.startsWith('paypay_money') ||
      st.step_id.startsWith('bank_transfer') ||
      st.step_id.startsWith('convenience_store_deposit')
    ));
  })();
  if (inDepositFlow) return null;

  const match = await matchBonusCode(env, conv.tenant_id, content);
  if (!match.matched) return null;

  // Determine whether this bonus code has follow-up buttons that need flow
  // re-entry (has_balance / game selection / plan choice). If so, set
  // flow_state to the bridge select step so the next click routes correctly.
  const bridgeStepId = `bonus_select_${match.row.type_key}`;
  const slotenMain = await env.DB.prepare(
    `SELECT id FROM bot_flows WHERE tenant_id = ? AND name = 'sloten-main' AND is_active = 1 LIMIT 1`,
  ).bind(conv.tenant_id).first();
  let hasBridge = false;
  if (slotenMain) {
    const flowRow = await env.DB.prepare('SELECT steps FROM bot_flows WHERE id = ?').bind(slotenMain.id).first();
    const flowSteps = bestEffortSync('messages:bonus-bridge:flow-steps',
      () => JSON.parse(flowRow?.steps || '[]')) || [];
    hasBridge = flowSteps.some((s) => s.id === bridgeStepId);
  }
  if (hasBridge && slotenMain) {
    const bridgeState = JSON.stringify({ flow_id: slotenMain.id, step_id: bridgeStepId, vars: {} });
    await env.DB.prepare(
      `UPDATE conversations SET flow_state=?, updated_at=datetime('now') WHERE id=?`,
    ).bind(bridgeState, conversationId).run();
  } else if (fresh.flow_state) {
    // No bridge — clear stale flow state.
    await env.DB.prepare(
      `UPDATE conversations SET flow_state=NULL, updated_at=datetime('now') WHERE id=?`,
    ).bind(conversationId).run();
  }

  let botReply = null;
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
    }, ctx);
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

// Stage 3: flow engine + AI fallback. Returns either a 201 Response (when the
// ai_fallback path completes) or null when flow messages were emitted /
// standalone AI replied (caller falls through to the standard 201 response).
async function runFlowOrAi(env, ctxArgs) {
  const { conv, fresh, contact, conversationId, content, contentAttributes, ctx, botReplies } = ctxArgs;
  const flowResult = await runFlowForCustomerMessage(env, fresh, contact, content, ctx, contentAttributes);

  if (flowResult.ai_fallback) {
    return runAiFallbackNavigation(env, ctxArgs, flowResult);
  }
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
      }, ctx);
      botReplies.push(botMsg);
    }
    return null;
  }
  // No flow active — fall back to AI chat.
  await runStandaloneAiChat(env, ctxArgs);
  return null;
}

// Stage 3a: ai_fallback path — user typed free text on a select step. Call AI
// for the answer, then either jump to a deeper menu (via deterministic keyword
// match) or re-offer the current menu.
async function runAiFallbackNavigation(env, ctxArgs, flowResult) {
  const { conv, fresh, contact, conversationId, msg, corsHeaders, botReplies, ctx } = ctxArgs;
  let history = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT sender_type, content FROM messages
        WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 6`,
    ).bind(conversationId).all();
    history = (results || []).reverse();
  } catch (_) {}

  // Load the active sloten-main flow once so we can validate jump targets and
  // rebuild flow_state if we navigate.
  let validJumpIds = new Set();
  let mainFlowId = null;
  try {
    const flowRow = await env.DB.prepare(
      `SELECT id, start_step_id, steps FROM bot_flows
        WHERE tenant_id = ? AND name = 'sloten-main' AND is_active = 1 LIMIT 1`,
    ).bind(conv.tenant_id).first();
    if (flowRow) {
      mainFlowId = flowRow.id;
      const flowSteps = bestEffortSync('messages:nav-tree:flow-steps',
        () => JSON.parse(flowRow.steps || '[]')) || [];
      const tree = buildMenuTreeText(flowSteps, flowRow.start_step_id, { maxDepth: 4 });
      validJumpIds = tree.validIds;
    }
  } catch (_) { /* navigation is optional */ }

  // Deterministic keyword matching decides the navigation target — the AI is
  // unreliable at picking the correct deep step ID, so we do this in JS.
  const curStateId = bestEffortSync('messages:nav-jump:curStateId',
    () => JSON.parse(fresh.flow_state || 'null')?.step_id) || null;
  const jumpToStepId = inferJumpTarget(flowResult.ai_fallback, validJumpIds, curStateId, { detectAnnouncement: detectAnnouncementQuery });

  const aiReply = await generateBotReply(env, {
    conversationId,
    tenantId: conv.tenant_id,
    customerMessage: flowResult.ai_fallback,
    ctx,
    history,
    menuContext: flowResult.current_menu, // { prompt, items }
  });

  // Strip any <jump-to> tags the AI might have generated — we ignore
  // AI-suggested navigation in favor of the deterministic match above.
  const cleanText = String(aiReply?.content || '')
    .replace(/<jump-to>\s*[a-zA-Z0-9_-]+\s*<\/jump-to>/gi, '')
    .trim();

  if (cleanText) {
    const aiMsg = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType: 'bot', senderId: null,
      content: cleanText,
      contentType: aiReply?.content_type || 'text',
      contentAttributes: aiReply?.content_attributes || null,
      isPrivate: false,
    }, ctx);
    botReplies.push(aiMsg);
  } else {
    // Silent-empty guard (Fix D, 2026-05-06): generateBotReply returned success
    // but empty content — typically a Gemini safetyBlock or finishReason=OTHER.
    const fallback = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType: 'bot', senderId: null,
      content: '申し訳ございません、ただいまうまくお答えできませんでした。下のメニューから関連項目をお選びいただくか、別の言い方でお試しください。',
      contentType: 'text', contentAttributes: null, isPrivate: false,
    }, ctx);
    botReplies.push(fallback);
  }

  if (aiReply?.handoff) {
    await env.DB.prepare(
      `UPDATE conversations SET status='open', updated_at=datetime('now') WHERE id=?`,
    ).bind(conversationId).run();
  }

  if (jumpToStepId && mainFlowId && !aiReply?.handoff) {
    // Navigate to the AI-suggested deep menu. Preserve any vars captured up
    // to this point so jumping into a sub-flow that depends on previous
    // answers still works.
    const cur = await env.DB.prepare('SELECT flow_state FROM conversations WHERE id = ?').bind(conversationId).first();
    const parsed = cur?.flow_state
      ? bestEffortSync('messages:jump-preserve-vars', () => JSON.parse(cur.flow_state))
      : null;
    const curVars = (parsed && typeof parsed.vars === 'object' && parsed.vars) ? parsed.vars : {};
    const newState = JSON.stringify({ flow_id: mainFlowId, step_id: jumpToStepId, vars: curVars });
    await env.DB.prepare(`UPDATE conversations SET flow_state = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(newState, conversationId).run();
    // Re-execute with no input — renders the destination menu.
    const fresh2 = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first();
    const jumpResult = await executeFlow(env, fresh2, contact, null, ctx);
    await env.DB.prepare(`UPDATE conversations SET flow_state = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(jumpResult.state ? JSON.stringify(jumpResult.state) : null, conversationId).run();
    for (const m of (jumpResult.messages || [])) {
      const botMsg = await insertMessage(env, {
        conversationId,
        tenantId: conv.tenant_id,
        senderType: 'bot', senderId: null,
        content: m.content,
        contentType: m.content_type || 'text',
        contentAttributes: m.content_attributes || null,
        isPrivate: false,
      }, ctx);
      botReplies.push(botMsg);
    }
  } else if (!aiReply?.handoff && flowResult.current_menu?.items?.length) {
    // No jump — re-offer the current menu so the user can navigate manually.
    const menuPrompt = flowResult.current_menu.prompt || 'メニューからお選びください。';
    const menuMsg = await insertMessage(env, {
      conversationId,
      tenantId: conv.tenant_id,
      senderType: 'bot', senderId: null,
      content: menuPrompt,
      contentType: 'input_select',
      contentAttributes: { items: flowResult.current_menu.items },
      isPrivate: false,
    }, ctx);
    botReplies.push(menuMsg);
  }
  const botReply = botReplies[botReplies.length - 1] || null;
  return created({ success: true, message: msg, bot_reply: botReply, bot_replies: botReplies }, corsHeaders);
}

// Stage 3b: standalone AI chat — no active flow, no fallback. Just call the
// LLM with the customer's message + recent history.
async function runStandaloneAiChat(env, ctxArgs) {
  const { conv, conversationId, content, ctx, botReplies } = ctxArgs;
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
  if (!reply || !reply.content) return;

  const botMsg = await insertMessage(env, {
    conversationId,
    tenantId: conv.tenant_id,
    senderType: 'bot', senderId: null,
    content: reply.content,
    contentType: reply.content_type || 'text',
    contentAttributes: reply.content_attributes,
    isPrivate: false,
  }, ctx);
  botReplies.push(botMsg);

  // If AI decided escalation, flip conversation to open so operators pick it
  // up immediately.
  if (reply.handoff) {
    await env.DB.prepare(
      `UPDATE conversations SET status='open', updated_at=datetime('now') WHERE id=?`,
    ).bind(conversationId).run();
  }
}
