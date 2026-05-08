# Backup / Restore Drill — staging-bk
#
# Purpose: verify that we can take a snapshot of the staging-bk D1 database
# and restore it cleanly. Tests the disaster-recovery path before we need it
# in anger.
#
# Usage:
#   cd C:\Users\PC\OneDrive\Desktop\sloten-standalone
#   .\scripts\backup-restore-drill.ps1 -Action backup
#   .\scripts\backup-restore-drill.ps1 -Action verify -BackupFile <path>
#   .\scripts\backup-restore-drill.ps1 -Action restore -BackupFile <path>  # DESTRUCTIVE
#
# This script runs against staging-bk only. Production restores require
# a documented runbook + manual approval.

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('backup', 'verify', 'restore', 'list')]
    [string]$Action,

    [string]$BackupFile = '',
    [string]$Config = 'wrangler.staging-bk.toml'
)

$ErrorActionPreference = "Stop"
$BackupDir = "C:\Users\PC\OneDrive\Desktop\sloten-standalone\backups"
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

function Get-DatabaseName {
    param([string]$ConfigFile)
    $line = Select-String -Path $ConfigFile -Pattern 'database_name\s*=' | Select-Object -First 1
    if ($line) {
        return ($line.Line -split '=')[1].Trim().Trim('"').Trim("'")
    }
    return $null
}

$dbName = Get-DatabaseName -ConfigFile $Config
if (-not $dbName) {
    Write-Error "Could not extract database_name from $Config"
    exit 1
}
Write-Host "Database: $dbName" -ForegroundColor Cyan

switch ($Action) {
    'backup' {
        $ts = Get-Date -Format 'yyyyMMdd-HHmm'
        $outFile = Join-Path $BackupDir "$dbName-$ts.json"
        Write-Host "Exporting all rows from key tables to $outFile..." -ForegroundColor Yellow
        # Export structured snapshot (JSON dump). For prod-grade backup, prefer
        # `wrangler d1 export` (dumps SQL). This is a logical row-level snapshot
        # for review/diff purposes.
        $tables = @('faq', 'knowledge_sources', 'bot_flows', 'bot_menus', 'ai_prompts', 'staff', 'tenants', 'feature_flags')
        $snapshot = @{}
        foreach ($t in $tables) {
            Write-Host "  exporting $t..." -ForegroundColor Gray
            $json = npx wrangler d1 execute $dbName --config $Config --remote --command "SELECT * FROM $t LIMIT 10000" --json 2>$null
            $snapshot[$t] = $json
        }
        $snapshot | ConvertTo-Json -Depth 30 -Compress | Out-File -FilePath $outFile -Encoding utf8
        Write-Host "✓ Backup written: $outFile" -ForegroundColor Green
        Write-Host "Size: $((Get-Item $outFile).Length) bytes"
    }
    'verify' {
        if (-not $BackupFile -or -not (Test-Path $BackupFile)) {
            Write-Error "BackupFile required and must exist"
            exit 1
        }
        Write-Host "Verifying $BackupFile..." -ForegroundColor Yellow
        try {
            $snap = Get-Content -Path $BackupFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            Write-Error "Backup file is not valid JSON: $_"
            exit 1
        }
        $tables = $snap.PSObject.Properties.Name
        Write-Host "Tables in backup: $($tables.Count)"
        foreach ($t in $tables) {
            $entries = $snap.$t
            Write-Host "  $t : present" -ForegroundColor Gray
        }
        Write-Host "✓ Backup file structurally valid" -ForegroundColor Green
    }
    'list' {
        Get-ChildItem -Path $BackupDir -Filter "*.json" | Sort-Object LastWriteTime -Descending | Format-Table Name, LastWriteTime, @{N='SizeKB';E={[math]::Round($_.Length/1KB, 1)}}
    }
    'restore' {
        Write-Host "RESTORE is intentionally not auto-implemented." -ForegroundColor Red
        Write-Host "For drill purposes, use:"
        Write-Host "  1. Spin up a fresh staging-bk-2 database"
        Write-Host "  2. Apply migrations"
        Write-Host "  3. Import each table's JSON via wrangler d1 execute"
        Write-Host "  4. Verify row counts match the backup"
        Write-Host ""
        Write-Host "Production restore requires DR runbook approval."
        exit 2
    }
}
