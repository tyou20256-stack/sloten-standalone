// Resolve the tenant_id for a request.
// Priority:
//   1) Cookie staff.tenant_id (locked to own tenant — query string ignored)
//   2) Bearer admin + explicit ?tenant_id=... (cross-tenant super-admin)
//   3) env.DEFAULT_TENANT_ID / 'tenant_default' (development only)
//
// Production fail-closed:
//   When ENVIRONMENT === 'production', a missing tenant context is treated
//   as a coding error: the function throws so the handler returns 500 rather
//   than silently writing to 'tenant_default'. Without this, an auth bug in
//   any handler (forgot to pass `request`, broken __staff injection) becomes
//   a multi-tenant data crossover. See architectural review 2026-05-09.
//
// Public widget endpoints that need a default tenant should pass
// `{ allowDefault: true }` explicitly.
//
// Use this in every read/write handler instead of reading ?tenant_id directly.

export function resolveTenantId(request, env, opts = {}) {
  const url = new URL(request.url);
  const queried = url.searchParams.get('tenant_id');
  const isProd = (env?.ENVIRONMENT || '').toLowerCase() === 'production';
  const allowDefault = opts.allowDefault === true;

  // Cookie staff: force own tenant — ignore caller-supplied value.
  const staff = request.__staff;
  if (staff && staff.tenant_id) return staff.tenant_id;

  // Bearer (super-admin) or anonymous widget request: honor explicit query param.
  if (queried) return queried;

  // No staff, no query: fall back to default — only when explicitly allowed
  // OR outside production. In production this is a fail-closed guard against
  // accidental cross-tenant data writes from missing auth context.
  if (!allowDefault && isProd) {
    throw new Error('tenant_id not resolved (production fail-closed)');
  }
  return env.DEFAULT_TENANT_ID || 'tenant_default';
}
