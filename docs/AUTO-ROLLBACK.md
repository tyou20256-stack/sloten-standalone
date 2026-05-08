# Auto-Rollback Strategy

> 2026-05-08 / Reality Checker HIGH (5/8 review): "p95 / error spike → rollback policy needed before prod"

## Goal

Detect post-deploy regressions automatically and roll back without human in
the loop. Targeted at the first 30 minutes after a Worker deploy.

## Trigger Sources

The metrics-monitor cron (5-minute window) is the primary signal. It writes
metrics to Telegram on threshold breach. We add a **deploy-gate** metric that
elevates the threshold to "rollback" when the previous deploy is younger
than 30 minutes.

## Auto-rollback rules (recommended)

| Metric | Steady-state threshold | First-30-min threshold | Action |
|---|---|---|---|
| error_rate | 5% warn / 15% page | 5% rollback | revert to N-1 |
| empty_rate | 10% warn | 10% rollback | revert to N-1 |
| p95_latency | 5000ms warn | 8000ms rollback | revert to N-1 |
| /health/db | 503 → page | 503 once → rollback | revert to N-1 |
| synthetic_uptime probe | fail → page | fail twice → rollback | revert to N-1 |

## Implementation Sketch (not yet wired)

```javascript
// In metrics-monitor.mjs checkAlerts()
async function shouldAutoRollback(env, metrics) {
  const lastDeployTs = await env.RATE_LIMITER.get('deploy:last:ts');
  if (!lastDeployTs) return false;
  const ageMs = Date.now() - Number(lastDeployTs);
  if (ageMs > 30 * 60 * 1000) return false; // post-30min: human-only

  return metrics.error_rate > 0.05
    || metrics.empty_rate > 0.10
    || metrics.p95_latency_ms > 8000;
}

async function autoRollback(env) {
  // Cloudflare Workers REST API: PATCH /accounts/.../workers/scripts/{name}/deployments
  // sets the active deployment to the previous version.
  // Requires CF_API_TOKEN with Workers Scripts:Edit
  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/sloten-standalone/deployments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategy: 'percentage',
      versions: [{ version_id: env.PREVIOUS_VERSION_ID, percentage: 100 }],
    }),
  });
  // Telegram + audit log
}
```

## Required Setup (gated on production existence)

1. `CF_API_TOKEN` secret (scoped: Workers Scripts Edit)
2. `CF_ACCOUNT_ID` env var
3. `PREVIOUS_VERSION_ID` updated on each deploy (via wrangler hook)
4. Deploy timestamp written to KV: `deploy:last:ts`

Wire this up in P-13 task once production exists.

## Manual Rollback (today)

```powershell
# List last 5 deployments
npx wrangler deployments list --config wrangler.toml | head -10

# Roll back to specific version
npx wrangler rollback <previous-version-id> --config wrangler.toml
```

Capture deploys to Telegram for forensics:
```bash
npx wrangler deploy --config wrangler.toml 2>&1 | \
  tee /tmp/deploy.log
# Extract Version ID and notify
```
