// Dashboard summary counts.

import { ok } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

export async function dashboardStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);

  // Run aggregates in parallel for speed on D1.
  const queries = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) n FROM faq WHERE tenant_id = ?`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM templates WHERE tenant_id = ?`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM knowledge_sources`).first(),
    env.DB.prepare(`SELECT status, COUNT(*) n FROM conversations WHERE tenant_id = ? GROUP BY status`).bind(tenantId).all(),
    env.DB.prepare(`SELECT COUNT(*) n FROM contacts WHERE tenant_id = ?`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM staff_members WHERE is_active = 1`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM labels WHERE tenant_id = ?`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM messages WHERE tenant_id = ? AND created_at >= datetime('now','-1 day')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM messages WHERE tenant_id = ? AND created_at >= datetime('now','-7 day')`).bind(tenantId).first(),
  ]);

  const statusBuckets = { bot: 0, open: 0, closed: 0 };
  for (const r of queries[3].results || []) statusBuckets[r.status] = r.n;

  return ok({
    success: true,
    stats: {
      faq_count: queries[0].n,
      template_count: queries[1].n,
      knowledge_count: queries[2].n,
      contact_count: queries[4].n,
      staff_count: queries[5].n,
      label_count: queries[6].n,
      conversations: {
        total: statusBuckets.bot + statusBuckets.open + statusBuckets.closed,
        bot: statusBuckets.bot,
        open: statusBuckets.open,
        closed: statusBuckets.closed,
      },
      messages_24h: queries[7].n,
      messages_7d: queries[8].n,
    },
  }, corsHeaders);
}
