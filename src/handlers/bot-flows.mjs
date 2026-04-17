// Bot flow engine + CRUD. Multi-step conversation workflows with webhooks.
//
// Step shape (JSON stored in bot_flows.steps):
//   { "id": "string-unique-within-flow", "type": "message"|"input"|"select"|"webhook"|"handoff", ... }
//
//   message:  { type:"message", content:"{{vars.foo}} をどうぞ", next:"step_id" }
//   input:    { type:"input",   prompt:"入力してください", var:"account_id",
//               validate:"^.{4,20}$", validate_error:"...", next:"step_id" }
//   select:   { type:"select",  prompt:"選択", var:"choice",
//               options:[{title:"PayPay",value:"paypay",next:"ask_id"}, ...] }
//   webhook:  { type:"webhook", url:"{{env.GAS_DEPOSIT_URL}}", method:"POST",
//               body:{account_id:"{{vars.account_id}}"}, timeout_ms:8000,
//               next:"step_id" }
//              The GAS response (JSON) may contain:
//                { message: "..."  -> sent as bot message
//                  set_vars: {...} -> merged into flow state
//                  next: "step_id" -> overrides step.next }
//   handoff:  { type:"handoff", assignee_id:null, note:"..." }
//              Clears flow_state, sets conversation.status='open'.
//
// Template syntax: "{{vars.x}}" / "{{contact.name}}" / "{{env.GAS_DEPOSIT_URL}}"

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';
import { signAttachmentUrl, baseUrlOf } from '../auth/attachment-signature.mjs';
import { resolveEnvForTemplate } from '../env-resolver.mjs';
import { logError as _logError } from '../audit.mjs';

const VALID_TRIGGER_TYPES = new Set(['entry', 'manual']);
const VALID_STEP_TYPES = new Set(['message', 'input', 'select', 'webhook', 'handoff', 'collect']);

function parseSteps(steps) {
  if (Array.isArray(steps)) return steps;
  if (typeof steps === 'string') {
    try { const a = JSON.parse(steps); return Array.isArray(a) ? a : null; } catch { return null; }
  }
  return null;
}

function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return 'steps must be a non-empty array';
  const ids = new Set();
  for (const s of steps) {
    if (!s || typeof s !== 'object') return 'each step must be an object';
    if (!s.id || typeof s.id !== 'string') return 'each step needs an id';
    if (ids.has(s.id)) return `duplicate step id: ${s.id}`;
    ids.add(s.id);
    if (!VALID_STEP_TYPES.has(s.type)) return `step ${s.id}: invalid type`;
    if (s.type === 'select' && !Array.isArray(s.options)) return `step ${s.id}: options required`;
    if (s.type === 'input' && !s.var) return `step ${s.id}: var required`;
    if (s.type === 'webhook' && !s.url) return `step ${s.id}: url required`;
    if (s.type === 'collect') {
      if (!Array.isArray(s.slots) || !s.slots.length) return `step ${s.id}: slots required`;
      for (const slot of s.slots) {
        if (!slot || !slot.var) return `step ${s.id}: slot.var required`;
        if (!slot.match || (!slot.match.regex && !slot.match.attachment)) {
          return `step ${s.id}: slot.match requires regex or attachment`;
        }
      }
    }
  }
  return null;
}

function decorate(row) {
  if (!row) return row;
  return { ...row, steps: parseSteps(row.steps) || [] };
}

// --- CRUD ---

export async function listBotFlows(request, env, corsHeaders) {
  const tenantId = resolveTenantId(request, env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM bot_flows WHERE tenant_id = ? ORDER BY priority DESC, id ASC'
  ).bind(tenantId).all();
  return ok({ success: true, flows: (results || []).map(decorate) }, corsHeaders);
}

export async function createBotFlow(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = resolveTenantId(request, env);
  const name = (body.name || '').trim();
  if (!name) return err('name required', 400, corsHeaders);
  const triggerType = body.trigger_type || 'entry';
  if (!VALID_TRIGGER_TYPES.has(triggerType)) return err('Invalid trigger_type', 400, corsHeaders);
  if (triggerType === 'entry' && body.trigger_value) {
    try { new RegExp(body.trigger_value); } catch { return err('Invalid regex', 400, corsHeaders); }
  }
  const steps = parseSteps(body.steps);
  const stepsErr = validateSteps(steps);
  if (stepsErr) return err(stepsErr, 400, corsHeaders);
  const startStepId = body.start_step_id || steps[0].id;
  if (!steps.some((s) => s.id === startStepId)) return err(`start_step_id '${startStepId}' not found`, 400, corsHeaders);

  const r = await env.DB.prepare(
    `INSERT INTO bot_flows (tenant_id, name, description, trigger_type, trigger_value, start_step_id, steps, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId, name, body.description || null, triggerType,
    triggerType === 'entry' ? (body.trigger_value || null) : null,
    startStepId, JSON.stringify(steps),
    parseInt(body.priority ?? 0, 10) || 0,
    body.is_active === false ? 0 : 1
  ).run();
  const row = await env.DB.prepare('SELECT * FROM bot_flows WHERE id = ?').bind(r.meta.last_row_id).first();
  return created({ success: true, flow: decorate(row) }, corsHeaders);
}

export async function updateBotFlow(request, env, corsHeaders, id) {
  const existing = await env.DB.prepare('SELECT * FROM bot_flows WHERE id = ?').bind(id).first();
  if (!existing) return err('Flow not found', 404, corsHeaders);
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const updates = [];
  const vals = [];
  if (body.name !== undefined) { updates.push('name = ?'); vals.push(String(body.name).trim()); }
  if (body.description !== undefined) { updates.push('description = ?'); vals.push(body.description || null); }
  if (body.trigger_type !== undefined) {
    if (!VALID_TRIGGER_TYPES.has(body.trigger_type)) return err('Invalid trigger_type', 400, corsHeaders);
    updates.push('trigger_type = ?'); vals.push(body.trigger_type);
  }
  if (body.trigger_value !== undefined) {
    if (body.trigger_value) { try { new RegExp(body.trigger_value); } catch { return err('Invalid regex', 400, corsHeaders); } }
    updates.push('trigger_value = ?'); vals.push(body.trigger_value || null);
  }
  if (body.steps !== undefined) {
    const steps = parseSteps(body.steps);
    const e = validateSteps(steps);
    if (e) return err(e, 400, corsHeaders);
    updates.push('steps = ?'); vals.push(JSON.stringify(steps));
    if (body.start_step_id) {
      if (!steps.some((s) => s.id === body.start_step_id)) return err('start_step_id not found', 400, corsHeaders);
      updates.push('start_step_id = ?'); vals.push(body.start_step_id);
    }
  } else if (body.start_step_id !== undefined) {
    const steps = parseSteps(existing.steps);
    if (!steps.some((s) => s.id === body.start_step_id)) return err('start_step_id not found', 400, corsHeaders);
    updates.push('start_step_id = ?'); vals.push(body.start_step_id);
  }
  if (body.priority !== undefined) { updates.push('priority = ?'); vals.push(parseInt(body.priority, 10) || 0); }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE bot_flows SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM bot_flows WHERE id = ?').bind(id).first();
  return ok({ success: true, flow: decorate(row) }, corsHeaders);
}

export async function deleteBotFlow(request, env, corsHeaders, id) {
  await env.DB.prepare('DELETE FROM bot_flows WHERE id = ?').bind(id).run();
  // Clear any conversations still pointing at this flow.
  await env.DB.prepare(`UPDATE conversations SET flow_state = NULL
                        WHERE flow_state LIKE '%"flow_id":' || ? || '%'`).bind(id).run();
  return ok({ success: true }, corsHeaders);
}

// --- Runtime engine ---

function renderTemplate(tpl, ctx) {
  if (tpl == null) return tpl;
  if (typeof tpl === 'string') {
    return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
      const parts = path.split('.');
      let cur = ctx;
      for (const p of parts) { cur = cur == null ? null : cur[p]; }
      return cur == null ? '' : String(cur);
    });
  }
  if (Array.isArray(tpl)) return tpl.map((v) => renderTemplate(v, ctx));
  if (typeof tpl === 'object') {
    const out = {};
    for (const k of Object.keys(tpl)) out[k] = renderTemplate(tpl[k], ctx);
    return out;
  }
  return tpl;
}

function findStep(flow, stepId) {
  return (flow.steps || []).find((s) => s.id === stepId) || null;
}

// Pick matching entry flow. Returns null if none matches.
export async function findEntryFlow(env, tenantId, userText) {
  const text = String(userText || '');
  if (!text) return null;
  const { results } = await env.DB.prepare(
    `SELECT * FROM bot_flows WHERE tenant_id = ? AND is_active = 1 AND trigger_type = 'entry' AND trigger_value IS NOT NULL
     ORDER BY priority DESC, id ASC`
  ).bind(tenantId).all();
  for (const row of (results || [])) {
    try {
      const re = new RegExp(row.trigger_value);
      if (re.test(text)) return decorate(row);
    } catch { /* skip */ }
  }
  return null;
}

export async function getFlow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM bot_flows WHERE id = ?').bind(id).first();
  return row ? decorate(row) : null;
}

// Build the JSON serializable flow_state row.
function newState(flow, vars = {}) {
  return JSON.stringify({ flow_id: flow.id, step_id: flow.start_step_id, vars });
}

async function persistState(env, conversationId, state) {
  await env.DB.prepare(`UPDATE conversations SET flow_state = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(state == null ? null : JSON.stringify(state), conversationId).run();
}

// Produce the bot message(s) that should be sent for the current step,
// advancing state when possible. Returns an array of message specs:
//   [{ content, content_type, content_attributes }]
// The engine stops when it hits an interactive step (input/select) or flow end.
// `input` is the customer's latest message (null when just entering a flow).
export async function executeFlow(env, conv, contact, inputText, ctx, inputAttrs = null) {
  const rawState = conv.flow_state ? (typeof conv.flow_state === 'string' ? JSON.parse(conv.flow_state) : conv.flow_state) : null;
  if (!rawState) return { messages: [], state: null, handoff: false };
  const flow = await getFlow(env, rawState.flow_id);
  if (!flow) { await persistState(env, conv.id, null); return { messages: [], state: null, handoff: false }; }

  let state = { flow_id: rawState.flow_id, step_id: rawState.step_id, vars: rawState.vars || {} };
  const messages = [];
  let handoff = false;
  let pending = inputText; // customer reply for the current interactive step
  const pendingAttachmentId = inputAttrs && inputAttrs.attachment_id ? String(inputAttrs.attachment_id) : null;

  // Safety cap: prevent runaway loops.
  for (let i = 0; i < 20; i++) {
    const step = findStep(flow, state.step_id);
    if (!step) break;

    if (step.type === 'input') {
      // When capture:'attachment', require an uploaded file; text alone prompts retry.
      if (step.capture === 'attachment') {
        if (pending == null && !pendingAttachmentId) {
          messages.push({ content: renderTemplate(step.prompt || '', { vars: state.vars, contact, env }), content_type: 'text' });
          break;
        }
        if (!pendingAttachmentId) {
          messages.push({ content: step.validate_error || '画像（スクリーンショット）を添付してください。', content_type: 'text' });
          break;
        }
        state.vars[step.var] = pendingAttachmentId;
        pending = null;
        state.step_id = step.next;
        if (!state.step_id) break;
        continue;
      }
      if (pending == null) {
        messages.push({ content: renderTemplate(step.prompt || '', { vars: state.vars, contact, env }), content_type: 'text' });
        break; // wait for customer
      }
      if (step.validate) {
        try {
          if (!new RegExp(step.validate).test(pending)) {
            messages.push({ content: step.validate_error || '入力形式が正しくありません。再度入力してください。', content_type: 'text' });
            break;
          }
        } catch (_) { /* invalid regex — skip */ }
      }
      state.vars[step.var] = pending;
      pending = null;
      state.step_id = step.next;
      if (!state.step_id) break;
      continue;
    }

    if (step.type === 'select') {
      if (pending == null) {
        const items = (step.options || []).map((o) => ({ title: o.title, value: o.value }));
        messages.push({
          content: renderTemplate(step.prompt || 'ご選択ください', { vars: state.vars, contact, env }),
          content_type: 'input_select',
          content_attributes: { items },
        });
        break;
      }
      const choice = (step.options || []).find((o) => o.value === pending || o.title === pending);
      if (!choice) {
        // Re-present the menu.
        const items = (step.options || []).map((o) => ({ title: o.title, value: o.value }));
        messages.push({
          content: renderTemplate('選択肢からお選びください', { vars: state.vars, contact, env }),
          content_type: 'input_select',
          content_attributes: { items },
        });
        break;
      }
      // Options can opt out of storing their value via `skip_var: true`
      // (e.g. "↩️ 戻る" buttons that should not pollute the business var).
      if (step.var && !choice.skip_var) {
        state.vars[step.var] = pending;
        // Also store the human-readable title so templates can reference it
        // as {{vars._choice_title}} etc. (useful for game names).
        state.vars[step.var + '_title'] = choice.title || pending;
      }
      pending = null;
      state.step_id = choice.next;
      if (!state.step_id) break;
      continue;
    }

    if (step.type === 'message') {
      const content = renderTemplate(step.content || '', { vars: state.vars, contact, env });
      if (content) messages.push({ content, content_type: 'text' });
      state.step_id = step.next;
      if (!state.step_id) break;
      continue;
    }

    // Collect: slot-filling step that captures multiple vars in any order.
    // Each slot has { var, match: {regex?|attachment?}, prompt, confirm? }.
    // On first entry, show `intro` + prompt for first unfilled slot.
    // On subsequent messages, map input to the first unfilled slot whose
    // detector matches. Emit `confirm` text (or default) + ask for next
    // missing slot. When all slots filled, advance to step.next.
    if (step.type === 'collect') {
      const slots = step.slots || [];
      const isUnfilled = (s) => !state.vars[s.var];
      const firstEntry = pending == null && !pendingAttachmentId
        && !slots.some((s) => state.vars[s.var]);

      if (firstEntry) {
        if (step.intro) {
          const c = renderTemplate(step.intro, { vars: state.vars, contact, env });
          if (c) messages.push({ content: c, content_type: 'text' });
        }
        const firstMissing = slots.find(isUnfilled);
        if (firstMissing) {
          messages.push({
            content: renderTemplate(firstMissing.prompt || '', { vars: state.vars, contact, env }),
            content_type: 'text',
          });
        }
        break;
      }

      // Try to fill one slot from the incoming message. Attachment input
      // can only fill attachment slots; text input only regex slots. First
      // unfilled slot in declared order whose detector matches wins.
      let filledSlot = null;
      if (pendingAttachmentId) {
        filledSlot = slots.find((s) => isUnfilled(s) && s.match && s.match.attachment === true);
        if (filledSlot) state.vars[filledSlot.var] = pendingAttachmentId;
      } else if (pending != null) {
        let rangeFailed = false;
        for (const s of slots) {
          if (!isUnfilled(s)) continue;
          if (!s.match || !s.match.regex) continue;
          try {
            if (!new RegExp(s.match.regex).test(pending)) continue;
          } catch (_) { continue; }
          // Optional numeric range validation. If the input parses as a
          // number and falls outside [min_numeric, max_numeric], emit the
          // slot's range_error (or a default) without filling the slot.
          if (s.min_numeric != null || s.max_numeric != null) {
            const n = Number(pending);
            const belowMin = s.min_numeric != null && n < s.min_numeric;
            const aboveMax = s.max_numeric != null && n > s.max_numeric;
            if (belowMin || aboveMax) {
              const msg = renderTemplate(
                s.range_error || `入力可能な範囲は ${s.min_numeric ?? '-'}〜${s.max_numeric ?? '-'} です。`,
                { vars: state.vars, contact, env },
              );
              messages.push({ content: msg, content_type: 'text' });
              rangeFailed = true;
              break;
            }
          }
          state.vars[s.var] = pending;
          filledSlot = s;
          break;
        }
        if (rangeFailed) {
          pending = null;
          break;
        }
      }
      pending = null;

      if (!filledSlot) {
        // Nothing matched. Emit the generic invalid-input notice (if any),
        // then re-show the prompt for the first still-missing slot so the
        // user sees the expected format.
        if (step.on_invalid) {
          messages.push({
            content: renderTemplate(step.on_invalid, { vars: state.vars, contact, env }),
            content_type: 'text',
          });
        }
        const nextMissing = slots.find(isUnfilled);
        if (nextMissing) {
          messages.push({
            content: renderTemplate(
              nextMissing.invalid_prompt || nextMissing.prompt || '',
              { vars: state.vars, contact, env },
            ),
            content_type: 'text',
          });
        } else if (!step.on_invalid) {
          messages.push({
            content: '入力内容を確認できませんでした。もう一度お送りください。',
            content_type: 'text',
          });
        }
        break;
      }

      // Optional confirmation after a slot is filled.
      if (filledSlot.confirm) {
        const c = renderTemplate(filledSlot.confirm, { vars: state.vars, contact, env });
        if (c) messages.push({ content: c, content_type: 'text' });
      }

      const stillMissing = slots.find(isUnfilled);
      if (stillMissing) {
        messages.push({
          content: renderTemplate(stillMissing.prompt || '', { vars: state.vars, contact, env }),
          content_type: 'text',
        });
        break;
      }

      // All slots filled → advance.
      state.step_id = step.next;
      if (!state.step_id) break;
      continue;
    }

    if (step.type === 'webhook') {
      let nextStepId = step.next || null;
      try {
        // Resolve env (with admin overrides applied) once per webhook step
        // so {{env.GAS_BOT_WEBHOOK_URL}} hits the override-aware getter.
        const resolvedEnv = await resolveEnvForTemplate(env);
        const url = renderTemplate(step.url, { vars: state.vars, contact, env: resolvedEnv });
        const bodyObj = renderTemplate(step.body || {}, { vars: state.vars, contact, env: resolvedEnv });
        // If vars contain attachment_id, expand it into a signed URL so GAS
        // can fetch the image/PDF without auth.
        const attachments = {};
        for (const k of Object.keys(state.vars || {})) {
          if (!/attachment(?:_id)?$/i.test(k)) continue;
          const aid = state.vars[k];
          if (!aid) continue;
          try {
            const att = await env.DB.prepare('SELECT id, filename, content_type, size_bytes FROM attachments WHERE id = ?').bind(aid).first();
            if (att) {
              const base = env.PUBLIC_WORKER_URL || '';
              attachments[k] = {
                id: att.id, filename: att.filename, content_type: att.content_type, size_bytes: att.size_bytes,
                url: base ? await signAttachmentUrl(env, att.id, base) : null,
              };
            }
          } catch (_) {}
        }
        const payload = {
          flow_id: flow.id,
          flow_name: flow.name,
          step_id: step.id,
          conversation_id: conv.id,
          contact: { id: contact?.id, name: contact?.name, email: contact?.email, phone: contact?.phone },
          vars: state.vars,
          attachments: Object.keys(attachments).length ? attachments : undefined,
          ...bodyObj,
        };
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), step.timeout_ms || 8000);
        const r = await fetch(url, {
          method: step.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        clearTimeout(timer);
        let data = null;
        try { data = await r.json(); } catch { /* non-JSON response */ }
        if (data && typeof data === 'object') {
          if (data.message) messages.push({ content: String(data.message), content_type: 'text' });
          if (data.set_vars && typeof data.set_vars === 'object') Object.assign(state.vars, data.set_vars);
          if (data.next) nextStepId = String(data.next);
        }
      } catch (e) {
        console.warn('[flow:webhook]', step.id, e.message);
        _logError(env, 'flow:webhook', e, { conversation_id: conv.id, step_id: step.id }).catch(() => {});
        // On failure, fall through to step.on_error or default next.
        if (step.on_error && findStep(flow, step.on_error)) nextStepId = step.on_error;
        messages.push({ content: step.error_message || 'システム連携でエラーが発生しました。担当者におつなぎします。', content_type: 'text' });
      }
      state.step_id = nextStepId;
      if (!state.step_id) break;
      continue;
    }

    if (step.type === 'handoff') {
      handoff = true;
      if (step.note) messages.push({ content: renderTemplate(step.note, { vars: state.vars, contact, env }), content_type: 'text' });
      state = null;
      break;
    }

    // Unknown step — abort
    break;
  }

  return { messages, state, handoff };
}

// Start a fresh flow for this conversation. Returns initial bot messages.
export async function startFlow(env, conv, contact, flow, ctx) {
  const initial = { flow_id: flow.id, step_id: flow.start_step_id, vars: {} };
  await persistState(env, conv.id, initial);
  const conv2 = { ...conv, flow_state: JSON.stringify(initial) };
  const result = await executeFlow(env, conv2, contact, null, ctx);
  await persistState(env, conv.id, result.state);
  return result;
}

// Called from sendMessage when customer sends a message. Returns bot messages
// to insert (empty array if no flow is active / matches). Also updates
// conversation state side-effects (flow_state, handoff -> status).
export async function runFlowForCustomerMessage(env, conv, contact, text, ctx, inputAttrs = null) {
  // Already in a flow?
  if (conv.flow_state) {
    const result = await executeFlow(env, conv, contact, text, ctx, inputAttrs);
    await persistState(env, conv.id, result.state);
    if (result.handoff) {
      await env.DB.prepare(`UPDATE conversations SET status = 'open', updated_at = datetime('now') WHERE id = ?`).bind(conv.id).run();
    }
    return result;
  }
  // Not in a flow: can we enter one?
  const entry = await findEntryFlow(env, conv.tenant_id, text);
  if (!entry) return { messages: [], state: null, handoff: false };
  return startFlow(env, conv, contact, entry, ctx);
}
