<#
Set xonix up to bake the national SD wind tiles on its RTX 5090 (docs/SD-FAST.md,
"More than one machine"; the job system is docs/SCENT-TESTSET.md, the service
section). Gavan runs it on xonix, from the share, in a normal PowerShell:

  powershell -ExecutionPolicy Bypass -File \\XEVO\windcfd2\sdtiles\xonix_sd_setup.ps1

Before the first run, on XEVO, in an admin PowerShell, share the staged maps
(read only, to the account xonix already uses for windcfd2):

  net share stage=C:\dev\huntapp\pipeline\raw\stage /grant:windcfg,READ

It is safe to run again; a second run pulls the code and copies only what changed.
What it does, in order:
  1. Python 3.14 (the py launcher), installed with winget if missing
  2. the packages the bake needs, pinned to XEVO's: torch 2.11 cu128, numpy,
     scipy, rasterio, pyproj, shapely, boto3
  3. the code: a sparse git checkout of the repo at C:\dev\huntapp (pipeline/,
     app/scripts/, app/src/areas/), or git pull if it is already there
  4. the wind net (runs/all: ckpt.pt, config.json) from \\XEVO\windcfd2\sdtiles
  5. the staged national maps (about 28 GB) from \\XEVO\stage with robocopy; if
     the share is not there, it offers to fetch them from NRCan (hours)
  6. the R2 keys the upload needs (user environment), asked for if missing
  7. checks: the GPU, the imports, the net loading on the GPU, and one test tile
     baked and timed (t-633-415, by Pickle Lake), then removed again so it is
     never uploaded over XEVO's copy

-SkipStage leaves the maps alone, -SkipTest skips the test tile.
#>
param(
  [string]$Repo = 'C:\dev\huntapp',
  [string]$Share = '\\XEVO\windcfd2',
  [string]$StageShare = '\\XEVO\stage',
  [switch]$SkipStage,
  [switch]$SkipTest
)
# not 'Stop': in Windows PowerShell 5.1 that turns any stderr line of py or git into an error;
# each step checks its exit code and throws instead
$ErrorActionPreference = 'Continue'
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Step($s) { Write-Host "`n== $s" -ForegroundColor Cyan }
function Ok($s) { Write-Host "   ok  $s" -ForegroundColor Green }
function Warn($s) { Write-Host "   !!  $s" -ForegroundColor Yellow }

# the staged boxes (pipeline/raw/stage/<name>/index.json on XEVO), for the NRCan fallback
$Boxes = [ordered]@{
  'on-north'    = '-95.25 44.2 -75.7 52.5'
  'on-south'    = '-83.6 41.6 -74.3 44.6'
  'qc-south'    = '-79.6 45.0 -61.5 49.6'
  'qc-north'    = '-74.51 49.45 -56.74 53.33'
  'on-farnorth' = '-95.36 50.25 -88.84 55.23'
  'pilot'       = '-85.95 48.59 -85.2 49.19'
}

Step '1. Python 3.14'
$py = 'py'
& $py -3.14 -c "import sys; print(sys.version)" 2>$null
if ($LASTEXITCODE) {
  Warn 'no Python 3.14: installing with winget'
  winget install -e --id Python.Python.3.14 --accept-package-agreements --accept-source-agreements
  Refresh-Path
  & $py -3.14 -c "import sys; print(sys.version)"
  if ($LASTEXITCODE) { throw 'Python 3.14 still missing: install it from python.org (with the py launcher), then run this again' }
}
Ok 'Python 3.14'

Step '2. Packages'
& $py -3.14 -c "import torch, numpy, scipy, rasterio, pyproj, shapely, boto3; assert torch.cuda.is_available() and torch.version.cuda >= '12.8'" 2>$null
if ($LASTEXITCODE) {
  & $py -3.14 -m pip install --upgrade pip
  & $py -3.14 -m pip install torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
  if ($LASTEXITCODE) { throw 'torch (cu128) did not install' }
  & $py -3.14 -m pip install numpy==2.4.0 scipy==1.17.1 rasterio==1.5.0 pyproj==3.7.2 shapely==2.1.2 boto3==1.43.111
  if ($LASTEXITCODE) { throw 'the packages did not install' }
}
& $py -3.14 -c "import torch; print('  ', torch.__version__, torch.cuda.get_device_name(0))"
if ($LASTEXITCODE) { throw 'torch cannot see the GPU: check the NVIDIA driver (570 or later for the 5090)' }
Ok 'packages'

Step '3. Code'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Warn 'no git: installing with winget'
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
if (Test-Path "$Repo\.git") {
  git -C $Repo pull --ff-only
  if ($LASTEXITCODE) { throw "git pull failed in $Repo" }
} else {
  # the data in app/public/data is most of the repo: only the bake's folders are checked out
  git clone --filter=blob:none --no-checkout https://github.com/GavanActon/huntapp.git $Repo
  if ($LASTEXITCODE) { throw 'git clone failed' }
  git -C $Repo sparse-checkout set --cone pipeline app/scripts app/src/areas
  git -C $Repo checkout main
  if ($LASTEXITCODE) { throw 'git checkout failed' }
}
Ok ("code at $Repo, " + (git -C $Repo log --oneline -1))

Step '4. The wind net'
$runs = "$Repo\pipeline\raw\surrogate\runs\all"
New-Item -ItemType Directory -Force $runs | Out-Null
robocopy "$Share\sdtiles\runs\all" $runs ckpt.pt config.json /R:3 /W:10 /NP /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "the net did not copy from $Share\sdtiles\runs\all" }
Ok "net in $runs"

Step '5. Staged maps'
$stage = "$Repo\pipeline\raw\stage"
if ($SkipStage) {
  Warn 'skipped (-SkipStage)'
} elseif (Test-Path $StageShare) {
  foreach ($name in $Boxes.Keys) {
    Write-Host "   $name ..."
    robocopy "$StageShare\$name" "$stage\$name" /E /Z /MT:8 /R:3 /W:10 /NP /NJH /NJS /NFL /NDL
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $name" }
  }
  Ok "maps in $stage"
} else {
  Warn "$StageShare is not there (share it on XEVO: see the top of this script)"
  $a = Read-Host '   Fetch the maps from NRCan instead? Several hours over the internet (y/N)'
  if ($a -eq 'y') {
    foreach ($name in $Boxes.Keys) {
      $box = $Boxes[$name] -split ' '
      & $py -3.14 "$Repo\pipeline\stage.py" fetch --name $name --box @box
      if ($LASTEXITCODE) { throw "stage.py fetch failed for $name" }
    }
    Ok "maps fetched into $stage"
  } else {
    Warn 'no staged maps: tiles will read them over the network, 2-3 times slower'
  }
}

Step '6. R2 keys (for the upload)'
foreach ($k in 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY') {
  if ([Environment]::GetEnvironmentVariable($k, 'User')) { Ok "$k is set"; continue }
  $s = Read-Host "   Paste $k (the same as XEVO's user environment; Enter to skip)" -AsSecureString
  $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  if ($v) { [Environment]::SetEnvironmentVariable($k, $v, 'User'); Ok "$k saved (new windows see it)" } else { Warn "$k not set: tiles bake but cannot upload" }
}

Step '7. Checks'
& $py -3.14 -c "import sys; sys.path[:0] = [r'$Repo\pipeline', r'$Repo\pipeline\surrogate']; from train import load_checkpoint; m, c = load_checkpoint(r'$runs\ckpt.pt', 'cuda'); print('   net loads on the GPU')"
if ($LASTEXITCODE) { throw 'the net would not load on the GPU' }
if (-not $SkipTest) {
  # one tile by Pickle Lake, already on R2 from XEVO: baked here, timed, then removed
  $out = "$Repo\pipeline\raw\windtiles\out"
  $t0 = Get-Date
  & $py -3.14 "$Repo\pipeline\wind_tiles.py" bake --box -84.976 48.491 -84.974 48.492 --jobs 1
  $ok = -not $LASTEXITCODE
  if ($ok -and (Test-Path "$out\t-633-415.json")) {
    $j = Get-Content "$out\t-633-415.json" -Raw | ConvertFrom-Json
    Ok ("test tile t-633-415: {0} s ({1})" -f $j.seconds, (($j.steps.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" }) -join ', '))
  } else {
    Warn ("the test tile failed after {0:N0} s: see $Repo\pipeline\raw\windtiles\work\t-633-415\bake.log" -f ((Get-Date) - $t0).TotalSeconds)
  }
  Remove-Item "$out\t-633-415.hab", "$out\t-633-415.json", "$out\index.json" -ErrorAction SilentlyContinue
}

Write-Host "`nxonix is set up for the SD wind tiles. Tell Claude on XEVO it's done (and the test tile's time)." -ForegroundColor Green
Write-Host "A batch runs as: py -3.14 $Repo\pipeline\wind_tiles.py bake --queue <batch.txt> --jobs 3 --upload-every 0"
