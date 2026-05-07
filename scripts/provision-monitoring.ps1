# provision-monitoring.ps1
# Provision Telegram bot secrets for metrics monitoring.
#
# Prerequisites:
#   1. Create a Telegram bot via @BotFather → get the token
#   2. Create a group chat, add the bot, get the chat_id
#      (send a message, then check https://api.telegram.org/bot<TOKEN>/getUpdates)
#
# Usage:
#   cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
#   .\scripts\provision-monitoring.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Telegram Monitoring Secrets ===" -ForegroundColor Cyan
Write-Host ""
$botToken = Read-Host "Enter TELEGRAM_BOT_TOKEN"
$chatId = Read-Host "Enter TELEGRAM_CHAT_ID"

if (-not $botToken -or -not $chatId) {
    Write-Host "Both values are required." -ForegroundColor Red
    exit 1
}

# --- Staging-bk ---
Write-Host ""
Write-Host "=== Provisioning to staging-bk ===" -ForegroundColor Yellow
$botToken | npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.staging-bk.toml
$chatId  | npx wrangler secret put TELEGRAM_CHAT_ID --config wrangler.staging-bk.toml
Write-Host "Staging-bk secrets set." -ForegroundColor Green

# --- Production (uncomment when ready) ---
# Write-Host ""
# Write-Host "=== Provisioning to production ===" -ForegroundColor Yellow
# $botToken | npx wrangler secret put TELEGRAM_BOT_TOKEN
# $chatId  | npx wrangler secret put TELEGRAM_CHAT_ID
# Write-Host "Production secrets set." -ForegroundColor Green

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Deploy: npx wrangler deploy --config wrangler.staging-bk.toml"
Write-Host "  2. Wait 5 minutes for first metrics check"
Write-Host "  3. Verify: check Telegram group for daily summary or trigger an error"
Write-Host ""
