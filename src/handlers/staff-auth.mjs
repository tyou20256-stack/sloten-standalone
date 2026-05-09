// Staff authentication: login / logout / me.
// Session = HMAC-signed token; server stores sha256(token) in staff_members.

import { ok, err, parseJson } from '../json.mjs';
import { verifyPassword } from '../auth/password.mjs';
import {
  createSessionToken, verifySessionToken, refreshSessionToken,
  cookieSerialize, parseCookies, sha256Hex, getSessionTTL, SESSION_TTL_SEC,
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

  const ttl = getSessionTTL(env);
  const { token, tokenHash, expiresAt } = await createSessionToken(env, {
    staffId: staff.id, email: staff.email, role: staff.role, ttlSec: ttl,
  });

  await env.DB.prepare(
    `UPDATE staff_members
        SET session_token_hash = ?, session_expires_at = ?,
            failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now')
      WHERE id = ?`
  ).bind(tokenHash, expiresAt, staff.id).run();

  // SameSite=Strict on admin cookie — admin panel is never embedded in 3rd-
  // party flows, so we trade off the rare "click email link to admin → no
  // session" UX for a hardened CSRF posture (CWE-352, audit 2026-05-09).
  const cookie = cookieSerialize(COOKIE_NAME, token, { maxAge: ttl, sameSite: 'Strict' });
  const headers = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie };
  return new Response(JSON.stringify({ success: true, staff: sanitize(staff) }), { status: 200, headers });
}

export async function logoutHandler(request, env, corsHeaders) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies[COOKIE_NAME];
  if (token) {
    try {
      const tokenHash = await sha256Hex(token);
      // DB: clear session (existing behaviour)
      await env.DB.prepare('UPDATE staff_members SET session_token_hash = NULL, session_expires_at = NULL WHERE session_token_hash = ?')
        .bind(tokenHash).run();
      // KV: revocation list — expires after one TTL cycle (auto-cleanup)
      const kv = env.SESSION_KV;
      if (kv) {
        await kv.put(`revoked:${tokenHash}`, '1', { expirationTtl: getSessionTTL(env) });
      }
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
// Adds KV revocation check and sliding-window token refresh.
export async function resolveStaffFromCookie(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = await verifySessionToken(env, token);
  if (!payload) return null;
  const tokenHash = await sha256Hex(token);

  // Revocation check — KV lookup (fast, ~30ms)
  const kv = env.SESSION_KV;
  if (kv) {
    try {
      if (await kv.get(`revoked:${tokenHash}`)) return null;
    } catch (_) { /* KV down → fall through to DB check */ }
  }

  const staff = await env.DB.prepare(
    'SELECT * FROM staff_members WHERE id = ? AND session_token_hash = ? AND is_active = 1'
  ).bind(payload.sid, tokenHash).first();
  if (!staff) return null;
  if (staff.session_expires_at && new Date(staff.session_expires_at) < new Date()) return null;

  // Sliding window: refresh token when past halfway through TTL
  const ttl = getSessionTTL(env);
  const remainingSec = payload.exp - Math.floor(Date.now() / 1000);
  if (remainingSec > 0 && remainingSec < ttl / 2) {
    try {
      const { token: newToken, tokenHash: newHash, expiresAt } = await refreshSessionToken(env, payload);
      await env.DB.prepare(
        'UPDATE staff_members SET session_token_hash = ?, session_expires_at = ? WHERE id = ?'
      ).bind(newHash, expiresAt, staff.id).run();
      // Attach refreshed cookie for middleware to set on response.
      // Match SameSite=Strict from issue path so cookie attributes don't drift.
      staff._refreshedCookie = cookieSerialize(COOKIE_NAME, newToken, { maxAge: ttl, sameSite: 'Strict' });
    } catch (_) { /* refresh failure is non-fatal — old token still valid */ }
  }

  return staff;
}

export { COOKIE_NAME };
