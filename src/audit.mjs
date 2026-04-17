// Audit + error logging helpers. Best-effort writes (never throw).
//
// Usage:
//   await audit(env, request, 'bonus_code.update', { resource_type, resource_id, payload });
//   await logError(env, 'sendMessage', err, { conversation_id });

function clientIp(request) {
  if (!request) return null;
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || null;
}

export async function audit(env, request, action, opts = {}) {
  if (!env?.DB || !action) return;
  const staff = request?.__staff || null;
  const tenantId = (env.DEFAULT_TENANT_ID || 'tenant_default');
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (tenant_id, staff_id, staff_email, action, resource_type, resource_id, payload, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      tenantId,
      staff?.id ?? null,
      staff?.email ?? null,
      action,
      opts.resource_type ?? null,
      opts.resource_id != null ? String(opts.resource_id) : null,
      opts.payload != null ? JSON.stringify(opts.payload).slice(0, 4000) : null,
      clientIp(request),
    ).run();
  } catch (_) { /* swallow */ }
}

export async function logError(env, source, err, context = {}) {
  if (!env?.DB || !source) return;
  const tenantId = (env.DEFAULT_TENANT_ID || 'tenant_default');
  const message = (err && (err.message || String(err))) || 'unknown';
  const stack = err && err.stack ? String(err.stack).slice(0, 4000) : null;
  try {
    await env.DB.prepare(
      `INSERT INTO error_log (tenant_id, source, message, stack, context, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      tenantId,
      String(source).slice(0, 100),
      String(message).slice(0, 1000),
      stack,
      Object.keys(context).length ? JSON.stringify(context).slice(0, 4000) : null,
      context.conversation_id ?? null,
    ).run();
  } catch (_) { /* swallow */ }
}
