// Resolve the tenant_id for a request.
// Priority:
//   1) Bearer admin + explicit ?tenant_id=... (cross-tenant super-admin)
//   2) Cookie staff.tenant_id (locked to own tenant — query string ignored)
//   3) env.DEFAULT_TENANT_ID / 'tenant_default'
//
// Use this in every read/write handler instead of reading ?tenant_id directly.

export function resolveTenantId(request, env) {
  const url = new URL(request.url);
  const queried = url.searchParams.get('tenant_id');

  // Cookie staff: force own tenant — ignore caller-supplied value.
  const staff = request.__staff;
  if (staff && staff.tenant_id) return staff.tenant_id;

  // Bearer (super-admin): honor explicit query param, else default.
  if (queried) return queried;
  return env.DEFAULT_TENANT_ID || 'tenant_default';
}
