// Webhook signature signing & verification.
//
// Used to authenticate outgoing webhook calls (sloten → BK receipt systems)
// and to verify incoming webhook responses if BK ever signs them back.
//
// Convention: HMAC-SHA256 over the request body, hex-encoded, sent in the
// `X-Sloten-Signature` header. Receiver re-computes and constant-time compares.
//
// This file currently isn't wired into bot-flows.mjs because the BK webhook
// URLs aren't provisioned yet (HANDOFF/11-external-requests.md). Wire it up
// at the same time as URL secret put.

import { hmacSignHex, hmacVerifyHex } from './crypto.mjs';

const HEADER_NAME = 'X-Sloten-Signature';
const TIMESTAMP_HEADER = 'X-Sloten-Timestamp';
const SIGNING_CONTEXT = 'webhook:v1';
// Reject signatures older than 5 minutes (replay defense)
const MAX_AGE_SEC = 300;

/**
 * Sign an outgoing webhook request body. Returns headers to attach.
 * The receiver is expected to verify body + timestamp before trusting.
 *
 * Production fail-closed: when env.ENVIRONMENT === 'production' and the
 * secret is missing, throw rather than silently sending unsigned webhooks.
 * Without this guard, a deploy that forgot to provision WEBHOOK_SIGNING_SECRET
 * silently downgrades to no-auth, defeating the purpose of signing.
 *
 * Pass `env` (Worker env) to enable the production guard. Callers that don't
 * have env (tests / scripts) can call with a single `secret` arg as before;
 * missing secret returns {} (no-op) for backward compat with non-prod paths.
 */
export async function signOutgoingWebhook(secret, body, env) {
  if (!secret) {
    const isProd = (env?.ENVIRONMENT || '').toLowerCase() === 'production';
    if (isProd) {
      throw new Error('WEBHOOK_SIGNING_SECRET not set in production — refusing to send unsigned webhook');
    }
    return {};
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${SIGNING_CONTEXT}|${timestamp}|${body}`;
  const sig = await hmacSignHex(secret, payload);
  return {
    [HEADER_NAME]: sig,
    [TIMESTAMP_HEADER]: timestamp,
  };
}

/**
 * Verify an incoming webhook request — used if BK signs callbacks back.
 * Returns true only when:
 *   - Header present
 *   - Timestamp within MAX_AGE_SEC
 *   - HMAC matches (constant-time)
 */
export async function verifyIncomingWebhook(secret, headers, body) {
  if (!secret) return false;
  const sig = headers.get(HEADER_NAME);
  const ts = headers.get(TIMESTAMP_HEADER);
  if (!sig || !ts) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSec > MAX_AGE_SEC) return false;
  const payload = `${SIGNING_CONTEXT}|${ts}|${body}`;
  return hmacVerifyHex(secret, payload, sig);
}

export const WEBHOOK_SIG_HEADERS = { HEADER_NAME, TIMESTAMP_HEADER };
