// Best-effort helper for non-blocking side-effects.
//
// Replaces `try { ... } catch (_) {}` clusters that silently muted any error.
// Failures are caught (so the caller's main path continues) but ALSO logged
// with a tag so production debugging doesn't have to guess what's broken.
//
// Code review (2026-05-09 audit) flagged ~15 sites where decideEscalation,
// bonusCode JSON parse, attachment lookup, audit_log writes, etc. wrap their
// side-effects in `try/_/{}`. When future bugs appear in those spots they'd
// be invisible. This helper makes them visible without changing semantics.
//
// Usage:
//   import { bestEffort } from '../lib/best-effort.mjs';
//   await bestEffort('escalation:check', () => decideEscalation(...));
//   bestEffort('audit:log', () => auditLog(...)).catch(() => {});

/**
 * Run `fn` and swallow any error after logging it under `label`. Returns the
 * function's return value, or `undefined` on error.
 *
 * Use this when a failure is genuinely OK to ignore for the request flow
 * (background sync, audit log, cache invalidation) — but you still want
 * production observability.
 *
 * @template T
 * @param {string} label  Short tag like 'audit:log' or 'flow:webhook-cleanup'
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T | undefined>}
 */
export async function bestEffort(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[best-effort] ${label} failed:`, e?.message || e);
    return undefined;
  }
}

/**
 * Synchronous variant — for callers that can't await (e.g. inside ctx.waitUntil
 * scheduling logic). Returns the value or undefined; never throws.
 *
 * @template T
 * @param {string} label
 * @param {() => T} fn
 * @returns {T | undefined}
 */
export function bestEffortSync(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.warn(`[best-effort] ${label} failed:`, e?.message || e);
    return undefined;
  }
}
