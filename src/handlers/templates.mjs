// 弊社側暫定実装 — tking510 納品版で置き換え予定
import { detectInputThreat } from '../responseFilter.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

const json = (obj, status, corsHeaders) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
const ok = (obj, corsHeaders) => json(obj, 200, corsHeaders);
const err = (msg, status, corsHeaders) => json({ success: false, error: msg }, status, corsHeaders);

async function parseJson(request, corsHeaders) {
  try { return { body: await request.json() }; }
  catch { return { response: err('Invalid JSON', 400, corsHeaders) }; }
}

const TPL_COLS = ['tenant_id', 'name', 'category', 'content', 'language', 'shortcut', 'usage_count', 'created_by'];

export async function handleTemplatesGet(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const tenantId = resolveTenantId(request, env);
    const { results } = await env.DB.prepare(
      'SELECT *, usage_count AS use_count FROM templates WHERE tenant_id = ? ORDER BY id DESC'
    ).bind(tenantId).all();
    return ok({ success: true, templates: results || [] }, corsHeaders);
  } catch (e) {
    console.error('handleTemplatesGet:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleTemplatesPost(request, env, corsHeaders) {
  const parsed = await parseJson(request, corsHeaders);
  if (parsed.response) return parsed.response;
  const {
    tenant_id = 'tenant_default', name, category = null, content,
    language = 'ja', shortcut = null, created_by = null,
  } = parsed.body;
  if (!name || !content) return err('name and content are required', 400, corsHeaders);
  // ο: prompt-injection guard (templates feed into LLM context)
  {
    const threat = detectInputThreat(`${name} ${content}`);
    if (threat?.suspicious) {
      console.warn('[templates] injection in payload:', threat.category);
      return err('Template content rejected: potential prompt injection detected', 400, corsHeaders);
    }
  }
  try {
    const result = await env.DB.prepare(
      `INSERT INTO templates (tenant_id, name, category, content, language, shortcut, usage_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`
    ).bind(tenant_id, name, category, content, language, shortcut, created_by).run();
    const id = result.meta?.last_row_id;
    const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
    return json({ success: true, template }, 201, corsHeaders);
  } catch (e) {
    console.error('handleTemplatesPost:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleTemplatesPut(request, env, corsHeaders, id) {
  const parsed = await parseJson(request, corsHeaders);
  if (parsed.response) return parsed.response;
  // ο: prompt-injection guard on update
  {
    const probe = `${parsed.body.name || ''} ${parsed.body.content || ''}`;
    if (probe.trim()) {
      const threat = detectInputThreat(probe);
      if (threat?.suspicious) {
        console.warn('[templates] injection in update:', threat.category);
        return err('Template content rejected: potential prompt injection detected', 400, corsHeaders);
      }
    }
  }
  try {
    const existing = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
    if (!existing) return err('Template not found', 404, corsHeaders);
    const sets = [];
    const vals = [];
    for (const col of TPL_COLS) {
      if (col in parsed.body) { sets.push(`${col} = ?`); vals.push(parsed.body[col]); }
    }
    if (sets.length === 0) {
      // HTML PUTs with empty body to bump usage_count — special-case that.
      await env.DB.prepare(
        "UPDATE templates SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
      const template = await env.DB.prepare('SELECT *, usage_count AS use_count FROM templates WHERE id = ?').bind(id).first();
      return ok({ success: true, template }, corsHeaders);
    }
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    await env.DB.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
    return ok({ success: true, template }, corsHeaders);
  } catch (e) {
    console.error('handleTemplatesPut:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function handleTemplatesDelete(request, env, corsHeaders, id) {
  try {
    const existing = await env.DB.prepare('SELECT id FROM templates WHERE id = ?').bind(id).first();
    if (!existing) return err('Template not found', 404, corsHeaders);
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
    return ok({ success: true, deleted: Number(id) }, corsHeaders);
  } catch (e) {
    console.error('handleTemplatesDelete:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}
