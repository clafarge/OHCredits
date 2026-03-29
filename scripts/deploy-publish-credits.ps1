# Deploy OHCredits Edge Function to Supabase (Windows / PowerShell).
# Prerequisites:
#   1) Node.js (npx). The Supabase CLI is NOT required globally — npx downloads it.
#   2) Logged in (pick one):
#        npx supabase login
#      OR set:
#        $env:SUPABASE_ACCESS_TOKEN = "<Dashboard → Account → Access Tokens>"
#
# Optional: set PUBLISH_SECRET in the Dashboard (Edge Functions -> Secrets) if not already set.

$ErrorActionPreference = "Stop"
# scripts/ -> repo root (OHCredits)
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root "supabase\functions\publish-credits\index.ts"))) {
  Write-Error "Could not find supabase/functions/publish-credits/index.ts under $root"
}

Set-Location $root
Write-Host "Project root: $root"

$ref = "uyufnbroqmwjtzvcsosv"

Write-Host @"

Deploying publish-credits to project $ref ...
  --no-verify-jwt  (required for browser CORS preflight from GitHub Pages)
  --use-api        (no Docker; bundles on Supabase servers)

If this fails with 'Access token', run (use npx — "supabase" alone is not on PATH unless you install the CLI globally):
  npx supabase login

"@

npx supabase functions deploy publish-credits `
  --project-ref $ref `
  --no-verify-jwt `
  --use-api `
  --yes

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host @"

Next steps (Dashboard):
  - Edge Functions -> publish-credits -> confirm name is exactly: publish-credits
  - Secrets: PUBLISH_SECRET must match Cloud settings in the OHCredits editor

Smoke test (expect 401 JSON, not 404):
  curl.exe -s -o NUL -w "HTTP %{http_code}`n" -X POST "https://$ref.supabase.co/functions/v1/publish-credits" -H "Content-Type: application/json" -d "{}"

"@
