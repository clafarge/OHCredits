# Apply supabase/migrations/20250328000000_credit_events.sql to your remote database.
#
# Do NOT put your password in this file or commit it to git.
#
# 1) Supabase Dashboard → Project Settings → Database → copy the URI under
#    "Connection string" (prefer "Session mode" / pooler if direct db.* fails on your network).
# 2) In PowerShell:
#      $env:DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@....supabase.co:6543/postgres"
#      .\scripts\apply-migration.ps1
#
# Or skip this script and paste the same SQL into Dashboard → SQL → New query.

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) {
  Write-Host "DATABASE_URL is not set." -ForegroundColor Yellow
  Write-Host "Set it to your Postgres URI from Supabase (Settings → Database), then run again."
  exit 1
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SqlFile = Join-Path $ProjectRoot "supabase\migrations\20250328000000_credit_events.sql"

if (-not (Test-Path $SqlFile)) {
  Write-Host "Migration file not found: $SqlFile" -ForegroundColor Red
  exit 1
}

Write-Host "Running migration via Supabase CLI..."
npx --yes supabase@latest db query -f $SqlFile --db-url $env:DATABASE_URL --agent=no
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done." -ForegroundColor Green
