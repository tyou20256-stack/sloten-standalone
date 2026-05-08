# rotate-signing-keys.ps1
# Generate 3 dedicated signing keys and provision them via wrangler secret put.
#
# Usage:
#   cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
#   .\scripts\rotate-signing-keys.ps1
#
# Prerequisites:
#   - Node.js + npx available in PATH
#   - wrangler authenticated (npx wrangler whoami)
#
# After running:
#   1. Deploy code (already has dual-verify fallback)
#   2. Wait 14 days for all legacy tokens to expire
#   3. Monitor: npx wrangler tail --config wrangler.staging-bk.toml --format pretty | Select-String "legacy SESSION_SIGNING_KEY"
#   4. Once legacy log count = 0, remove fallback code + delete old SESSION_SIGNING_KEY

$ErrorActionPreference = "Stop"

# Generate 32-byte random keys (hex-encoded, 64 chars).
# Use Create()+GetBytes() for PS 5.1 compatibility (Fill() is .NET Core 3+).
function New-HexKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ''
}

$staffKey   = New-HexKey
$contactKey = New-HexKey
$ragKey     = New-HexKey

Write-Host ""
Write-Host "Generated signing keys (32 bytes hex):" -ForegroundColor Cyan
Write-Host "  STAFF_SESSION_SIGNING_KEY  = $staffKey"
Write-Host "  CONTACT_TOKEN_SIGNING_KEY  = $contactKey"
Write-Host "  RAG_CACHE_SIGNING_KEY      = $ragKey"
Write-Host ""

# --- Staging-bk ---
Write-Host "=== Provisioning to staging-bk ===" -ForegroundColor Yellow
$staffKey   | npx wrangler secret put STAFF_SESSION_SIGNING_KEY  --config wrangler.staging-bk.toml
$contactKey | npx wrangler secret put CONTACT_TOKEN_SIGNING_KEY  --config wrangler.staging-bk.toml
$ragKey     | npx wrangler secret put RAG_CACHE_SIGNING_KEY      --config wrangler.staging-bk.toml
Write-Host "Staging-bk secrets provisioned." -ForegroundColor Green

# --- Production (uncomment when ready) ---
# Write-Host "=== Provisioning to production ===" -ForegroundColor Yellow
# $staffKey   | npx wrangler secret put STAFF_SESSION_SIGNING_KEY
# $contactKey | npx wrangler secret put CONTACT_TOKEN_SIGNING_KEY
# $ragKey     | npx wrangler secret put RAG_CACHE_SIGNING_KEY
# Write-Host "Production secrets provisioned." -ForegroundColor Green

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Deploy: npx wrangler deploy --config wrangler.staging-bk.toml"
Write-Host "  2. Verify: curl login + /api/staff/me returns 200"
Write-Host "  3. Monitor for 14 days: wrangler tail | grep 'legacy SESSION_SIGNING_KEY'"
Write-Host "  4. When legacy count = 0: wrangler secret delete SESSION_SIGNING_KEY"
Write-Host ""
