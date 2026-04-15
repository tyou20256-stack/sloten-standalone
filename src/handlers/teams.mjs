// Teams + team membership CRUD. Admin only.

import { ok, created, err, parseJson } from '../json.mjs';
import { resolveTenantId } from '../tenant-scope.mjs';

export async function listTeams(request, env, corsHeaders) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request, env);
  const teams = (await env.DB.prepare(
    'SELECT * FROM teams WHERE tenant_id = ? ORDER BY name ASC'
  ).bind(tenantId).all()).results || [];
  if (teams.length === 0) return ok({ success: true, teams: [] }, corsHeaders);
  const ids = teams.map((t) => t.id);
  const ph = ids.map(() => '?').join(',');
  const { results: members } = await env.DB.prepare(
    `SELECT tm.team_id, s.id, s.email, s.name, s.role
       FROM team_members tm
       JOIN staff_members s ON s.id = tm.staff_id
      WHERE tm.team_id IN (${ph})`
  ).bind(...ids).all();
  const byTeam = {};
  for (const m of (members || [])) (byTeam[m.team_id] ||= []).push({ id: m.id, email: m.email, name: m.name, role: m.role });
  for (const t of teams) t.members = byTeam[t.id] || [];
  return ok({ success: true, teams }, corsHeaders);
}

export async function createTeam(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const name = (body.name || '').trim();
  if (!name) return err('name required', 400, corsHeaders);
  const tenantId = body.tenant_id || env.DEFAULT_TENANT_ID || 'tenant_default';
  try {
    const r = await env.DB.prepare(
      'INSERT INTO teams (tenant_id, name, description) VALUES (?, ?, ?)'
    ).bind(tenantId, name, body.description || null).run();
    const row = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(r.meta.last_row_id).first();
    return created({ success: true, team: { ...row, members: [] } }, corsHeaders);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return err('Team name already exists', 409, corsHeaders);
    throw e;
  }
}

export async function updateTeam(request, env, corsHeaders, id) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const updates = [];
  const vals = [];
  if (body.name !== undefined) { updates.push('name = ?'); vals.push(String(body.name).trim()); }
  if (body.description !== undefined) { updates.push('description = ?'); vals.push(body.description || null); }
  if (updates.length === 0) return err('No updatable fields', 400, corsHeaders);
  updates.push(`updated_at = datetime('now')`);
  vals.push(id);
  await env.DB.prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
  if (!row) return err('Team not found', 404, corsHeaders);
  return ok({ success: true, team: row }, corsHeaders);
}

export async function deleteTeam(request, env, corsHeaders, id) {
  await env.DB.prepare('UPDATE conversations SET team_id = NULL WHERE team_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return ok({ success: true }, corsHeaders);
}

export async function addTeamMember(request, env, corsHeaders, teamId) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const staffId = parseInt(body.staff_id, 10);
  if (!staffId) return err('staff_id required', 400, corsHeaders);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_members (team_id, staff_id) VALUES (?, ?)`
  ).bind(teamId, staffId).run();
  return ok({ success: true }, corsHeaders);
}

export async function removeTeamMember(request, env, corsHeaders, teamId, staffId) {
  await env.DB.prepare(
    `DELETE FROM team_members WHERE team_id = ? AND staff_id = ?`
  ).bind(teamId, staffId).run();
  return ok({ success: true }, corsHeaders);
}
