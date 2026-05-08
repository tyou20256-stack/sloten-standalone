# Dependency Security Audit
#
# Wraps npm audit with project-specific thresholds and output formatting.
# Exit codes:
#   0 — no high/critical vulnerabilities
#   1 — high or critical found
#   2 — npm error
#
# Usage:
#   .\scripts\dep-audit.ps1
#   .\scripts\dep-audit.ps1 -Severity high  # raise threshold

param(
    [ValidateSet('low', 'moderate', 'high', 'critical')]
    [string]$Severity = 'high'
)

$ErrorActionPreference = "Stop"
Write-Host "Running npm audit (level=$Severity)..." -ForegroundColor Cyan

try {
    $auditOutput = npm audit --json 2>&1
    $audit = $auditOutput | ConvertFrom-Json
} catch {
    Write-Error "Failed to run npm audit: $_"
    exit 2
}

$counts = $audit.metadata.vulnerabilities
Write-Host ""
Write-Host "Vulnerability counts:" -ForegroundColor Yellow
Write-Host "  Critical: $($counts.critical)"
Write-Host "  High:     $($counts.high)"
Write-Host "  Moderate: $($counts.moderate)"
Write-Host "  Low:      $($counts.low)"
Write-Host "  Info:     $($counts.info)"
Write-Host "  Total:    $($counts.total)"

# Write report to file
$reportDir = "C:\Users\PC\OneDrive\Desktop\sloten-standalone\reports"
if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir | Out-Null }
$ts = Get-Date -Format 'yyyyMMdd-HHmm'
$reportFile = Join-Path $reportDir "npm-audit-$ts.json"
$auditOutput | Out-File -FilePath $reportFile -Encoding utf8
Write-Host ""
Write-Host "Full report: $reportFile" -ForegroundColor Gray

# Threshold check
$blockerCount = 0
if ($Severity -eq 'critical') { $blockerCount = $counts.critical }
elseif ($Severity -eq 'high') { $blockerCount = $counts.critical + $counts.high }
elseif ($Severity -eq 'moderate') { $blockerCount = $counts.critical + $counts.high + $counts.moderate }
else { $blockerCount = $counts.total }

if ($blockerCount -gt 0) {
    Write-Host ""
    Write-Host "✗ FAIL: $blockerCount vulnerabilities at or above '$Severity' level" -ForegroundColor Red
    Write-Host "Run 'npm audit' for details, or 'npm audit fix' to auto-fix what's safe." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "✓ PASS: No vulnerabilities at '$Severity' level or higher" -ForegroundColor Green
exit 0
