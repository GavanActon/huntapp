# Build the app from this working tree and put it on the dev site,
# https://hunt-dev.groundwind.app (also https://groundwind-hunt-dev.gavan-acton.workers.dev).
# Nothing is committed or pushed; the live app at hunt.groundwind.app is untouched.
#
#   powershell -ExecutionPolicy Bypass -File app/scripts/deploy-dev.ps1 [-SkipSync]
#
# The build reads its data from R2 (VITE_DATA_BASE), shows a DEV badge and
# sends no usage stats (VITE_DEV_SITE). Run from PowerShell, not Git Bash:
# Git Bash turns BASE_PATH=/ into C:/Program Files/Git/ and the page loads
# nothing. R2's data/ is shared with the live app's prepared switch: once the
# live app reads R2, give the dev site a prefix of its own before syncing
# from an uncommitted tree.
param([switch]$SkipSync)
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot '..'
Set-Location $app
$env:BASE_PATH = '/'
$env:VITE_DATA_BASE = 'https://data.groundwind.app/data/'
$env:VITE_DEV_SITE = '1'
npx tsc -b
if ($LASTEXITCODE) { throw 'tsc failed' }
npx vite build --outDir dist-dev --emptyOutDir
if ($LASTEXITCODE) { throw 'build failed' }
if (-not $SkipSync) {
  py -3.14 scripts/r2_sync.py --manifests dist-dev/data
  if ($LASTEXITCODE) { throw 'r2 sync failed' }
}
Set-Location (Join-Path $app 'dev-site')
npx wrangler deploy
if ($LASTEXITCODE) { throw 'deploy failed' }
