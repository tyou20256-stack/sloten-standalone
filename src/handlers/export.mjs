// CSV exporter. UTF-8 BOM prefix for Excel compatibility.

const BOM = '\uFEFF';

function csvEscape(v) {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'object') { try { s = JSON.stringify(v); } catch { s = String(v); } }
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return BOM + header + '\n' + body + '\n';
}

const RESOURCES = {
  conversations: {
    columns: ['id', 'tenant_id', 'contact_id', 'status', 'priority', 'labels', 'assignee_id', 'last_message_at', 'last_message_preview', 'unread_count_staff', 'external_id', 'created_at', 'updated_at', 'closed_at'],
    query: (tenantId, since, until) =>
      `SELECT * FROM conversations WHERE tenant_id = ?${since ? ' AND created_at >= ?' : ''}${until ? ' AND created_at <= ?' : ''} ORDER BY created_at DESC`,
  },
  messages: {
    columns: ['id', 'conversation_id', 'tenant_id', 'sender_type', 'sender_id', 'content', 'content_type', 'is_private', 'external_id', 'created_at'],
    query: (tenantId, since, until) =>
      `SELECT * FROM messages WHERE tenant_id = ?${since ? ' AND created_at >= ?' : ''}${until ? ' AND created_at <= ?' : ''} ORDER BY created_at DESC`,
  },
  contacts: {
    columns: ['id', 'tenant_id', 'name', 'email', 'phone', 'is_identified', 'external_id', 'metadata', 'created_at', 'updated_at'],
    query: (tenantId, since, until) =>
      `SELECT * FROM contacts WHERE tenant_id = ?${since ? ' AND created_at >= ?' : ''}${until ? ' AND created_at <= ?' : ''} ORDER BY created_at DESC`,
  },
  faq: {
    columns: ['id', 'tenant_id', 'question', 'answer', 'category', 'language', 'priority', 'usage_count', 'view_count', 'helpful_count', 'is_active', 'created_at', 'updated_at'],
    query: (tenantId) => `SELECT * FROM faq WHERE tenant_id = ? ORDER BY id DESC`,
  },
  templates: {
    columns: ['id', 'tenant_id', 'name', 'category', 'content', 'language', 'shortcut', 'usage_count', 'is_active', 'created_at', 'updated_at'],
    query: (tenantId) => `SELECT * FROM templates WHERE tenant_id = ? ORDER BY id DESC`,
  },
  knowledge: {
    columns: ['id', 'title', 'url', 'category', 'content', 'source_type', 'priority', 'is_active', 'created_at', 'updated_at'],
    query: () => `SELECT * FROM knowledge_sources ORDER BY id DESC`,
    noTenant: true,
  },
  staff: {
    columns: ['id', 'tenant_id', 'email', 'name', 'role', 'is_active', 'phone', 'department', 'language', 'last_login_at', 'created_at', 'updated_at'],
    query: () => `SELECT id, tenant_id, email, name, role, is_active, phone, department, language, last_login_at, created_at, updated_at FROM staff_members ORDER BY id ASC`,
    noTenant: true,
  },
  ai_logs: {
    columns: ['id', 'tenant_id', 'conversation_id', 'provider', 'model', 'input', 'output', 'tokens_in', 'tokens_out', 'latency_ms', 'status', 'error_message', 'created_at'],
    query: (tenantId, since, until) =>
      `SELECT * FROM ai_logs WHERE tenant_id = ?${since ? ' AND created_at >= ?' : ''}${until ? ' AND created_at <= ?' : ''} ORDER BY created_at DESC`,
  },
};

export async function exportCsv(request, env, corsHeaders, resource) {
  const def = RESOURCES[resource];
  if (!def) {
    return new Response(JSON.stringify({ error: `Unknown resource: ${resource}` }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || env.DEFAULT_TENANT_ID || 'tenant_default';
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');

  const args = [];
  if (!def.noTenant) args.push(tenantId);
  if (since && def.query.length >= 2) args.push(since);
  if (until && def.query.length >= 3) args.push(until);

  try {
    const sql = def.query(tenantId, since, until);
    const stmt = env.DB.prepare(sql);
    const { results } = await (args.length ? stmt.bind(...args) : stmt).all();
    const csv = toCsv(results || [], def.columns);
    const fn = `${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fn}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[export]', resource, e.message);
    return new Response(JSON.stringify({ error: 'Export failed: ' + e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
