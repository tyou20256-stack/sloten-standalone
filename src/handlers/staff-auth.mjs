// Staff authentication: login / logout / me.
// Session = HMAC-signed token; server stores sha256(token) in staff_members.

import { ok, err, parseJson } from '../json.mjs';
import { verifyPassword } from '../auth/password.mjs';
import {
  createSessionToken, verifySessionToken, cookieSerialize, parseCookies, sha256Hex, SESSION_TTL_SEC,
} from '../auth/session.mjs';

const COOKIE_NAME = 'sloten_staff_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function sanitize(row) {
  if (!row) return null;
  const { password_hash, password_salt, session_token_hash, ...rest } = row;
  return rest;
}

export async function loginHandler(request, env, corsHeaders) {
  const { body, response } = await parseJson(request, corsHeaders);
  if (response) return response;
  const email = (body.email || '').toLowerCase().trim();
  const password = body.password || '';
  if (!email || !password) return err('email and password required', 400, corsHeaders);

  const staff = await env.DB.prepare('SELECT * FROM staff_members WHERE lower(email) = ? AND is_active = 1')
    .bind(email).first();
  if (!staff) return err('Invalid credentials', 401, corsHeaders);
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    return err('Account locked. Try again later.', 423, corsHeaders);
  }

  const okPw = await verifyPassword(password, staff.password_hash, staff.password_salt);
  if (!okPw) {
    const attempts = (staff.failed_attempts || 0) + 1;
    const lockUntil = attempts >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    await env.DB.prepare('UPDATE staff_members SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .bind(attempts, lockUntil, staff.id).run();
    return err('Invalid credentials', 401, corsHeaders);
  }

  const { token, tokenHash, expiresAt } = await createSessionToken(env, {
    staffId: staff.id, email: staff.email, role: staff.role,
  });

  await env.DB.prepare(
    `UPDATE staff_members
        SET session_token_hash = ?, session_expires_at = ?,
            failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now')
      WHERE id = ?`
  ).bind(tokenHash, expiresAt, staff.id).run();

  const cookie = cookieSerialize(COOKIE_NAME, token, { maxAge: SESSION_TTL_SEC });
  const headers = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie };
  return new Response(JSON.stringify({ success: true, staff: sanitize(staff) }), { status: 200, headers });
}

export async function logoutHandler(request, env, corsHeaders) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies[COOKIE_NAME];
  if (token) {
    try {
      const tokenHash = await sha256Hex(token);
      await env.DB.prepare('UPDATE staff_members SET session_token_hash = NULL, session_expires_at = NULL WHERE session_token_hash = ?')
        .bind(tokenHash).run();
    } catch (_) { /* best effort */ }
  }
  const cookie = cookieSerialize(COOKIE_NAME, '', { maxAge: 0 });
  const headers = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie };
  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

export async function meHandler(request, env, corsHeaders) {
  const staff = await resolveStaffFromCookie(request, env);
  if (!staff) return err('Unauthorized', 401, corsHeaders);
  return ok({ success: true, staff: sanitize(staff) }, corsHeaders);
}

// Called from router middleware. Returns staff row or null.
export async function resolveStaffFromCookie(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = await verifySessionToken(env, token);
  if (!payload) return null;
  const tokenHash = await sha256Hex(token);
  const staff = await env.DB.prepare(
    'SELECT * FROM staff_members WHERE id = ? AND session_token_hash = ? AND is_active = 1'
  ).bind(payload.sid, tokenHash).first();
  if (!staff) return null;
  if (staff.session_expires_at && new Date(staff.session_expires_at) < new Date()) return null;
  return staff;
}

export { COOKIE_NAME };
