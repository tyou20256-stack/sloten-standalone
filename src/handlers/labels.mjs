// Labels catalog — per-tenant named tags with optional color.

import { ok, created, err, parseJson } from '../json.mjs';

function validColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

export async function listLabels(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || env.DEFAULT_TENANT_ID || 'tenant_default';
  const { results } = await env.DB.prepare(
    'SELECT * FROM labels WHERE tenant_id = ? ORDER BY name ASC'
  ).bind(tenantId).all();
  return ok({ success: true, labels: results || [] }, corsHeaders);
}

export async function createLabel(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const tenantId = body.tenant_id || env.DEFAULT_TENANT_ID || 'tenant_default';
  const name = (body.name || '').trim();
  if (!name) return err('name required', 400, corsHeaders);
  if (name.length > 40) return err('name too long (max 40)', 400, corsHeaders);
  const color = validColor(body.color) ? body.color : '#6b7280';
  try {
    const r = await env.DB.prepare(
      'INSERT INTO labels (tenant_id, name, color, description) VALUES (?, ?, ?, ?)'
    ).bind(tenantId, name, color, body.description || null).run();
    const row = await env.DB.prepare('SELECT * FROM labels WHERE id = ?').bind(r.meta.last_row_id).first();
    return created({ success: true, label: row }, corsHeaders);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return err('Label already exists', 409, corsHeaders);
    console.error('createLabel:', e.message);
    return err('Internal error', 500, corsHeaders);
  }
}

export async function updateLabel(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const updates = [];
  const vals = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return err('name cannot be empty', 400, corsHeaders);
    updates.push('name = ?'); vals.push(name);
  }
  if (body.color !== undefined) {
    if (!validColor(body.color)) return err('invalid color', 400, corsHeaders);
    updates.push('color = ?'); vals.push(body.color);
  }
  if (body.description !== undefined) {
    updates.push('description = ?'); vals.push(body.description || null);
  }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE labels SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM labels WHERE id = ?').bind(id).first();
  if (!row) return err('Label not found', 404, corsHeaders);
  return ok({ success: true, label: row }, corsHeaders);
}

export async function deleteLabel(request, env, corsHeaders, id) {
  const existing = await env.DB.prepare('SELECT name FROM labels WHERE id = ?').bind(id).first();
  if (!existing) return err('Label not found', 404, corsHeaders);
  await env.DB.prepare('DELETE FROM labels WHERE id = ?').bind(id).run();
  // Remove the label name from any conversations referencing it (CSV cleanup).
  // Cheap for small fleets; for larger scale, use JSON_each or separate join table.
  await env.DB.prepare(
    `UPDATE conversations
        SET labels = TRIM(
          REPLACE(
            REPLACE(',' || COALESCE(labels,'') || ',', ',' || ? || ',', ','),
            ',,', ','
          ),
          ','
        )
      WHERE labels LIKE ? ESCAPE '\\'`
  ).bind(existing.name, `%${existing.name}%`).run();
  return ok({ success: true }, corsHeaders);
}
