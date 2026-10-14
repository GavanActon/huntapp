# Build the app from this working tree and upload it as a preview of the dev
# site, at https://try-groundwind-hunt-dev.gavan-acton.workers.dev. The dev
# site itself (https://hunt-dev.groundwind.app) is main's, put there by
# .github/workflows/dev.yml on every push; the live app, hunt.groundwind.app,
# moves only with the `live` branch (docs/DEPLOY.md).
#
#   powershell -ExecutionPolicy Bypass -File app/scripts/deploy-dev.ps1 [-SkipSync]
#
# Nothing is committed or pushed. The badge reads TRY, not DEV: the commit it
# names is the tree's base, uncommitted changes on top, so it is never one to
# promote. The build reads its data from R2 (VITE_DATA_BASE) and sends no
# usage stats. The sync sends this tree's data, uncommitted bakes too, to the
# R2 data/ that hunt-dev reads as well; -SkipSync for a code-only try. Run
# from PowerShell, not Git Bash: Git Bash turns BASE_PATH=/ into
# C:/Program Files/Git/ and the page loads nothing.
param([switch]$SkipSync)
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot '..'
Set-Location $app
$env:BASE_PATH = '/'
$env:VITE_DATA_BASE = 'https://data.groundwind.app/data/'
$env:VITE_DEV_SITE = 'try'
npx tsc -b
if ($LASTEXITCODE) { throw 'tsc failed' }
npx vite build --outDir dist-dev --emptyOutDir
if ($LASTEXITCODE) { throw 'build failed' }
if (-not $SkipSync) {
  py -3.14 scripts/r2_sync.py --manifests dist-dev/data
  if ($LASTEXITCODE) { throw 'r2 sync failed' }
}
Set-Location (Join-Path $app 'dev-site')
# wrangler's own login (Gavan's): the CLOUDFLARE_API_TOKEN in this PC's environment cannot see the dev Worker
$env:CLOUDFLARE_API_TOKEN = $null
npx wrangler versions upload --preview-alias try --message 'try from a working tree'
if ($LASTEXITCODE) { throw 'upload failed' }
