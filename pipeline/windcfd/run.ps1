<#
  The momentum solve's runner (pipeline/build_windcfd.py). Works through the
  kit's jobs, one (area, direction) at a time: claims one nobody has, runs
  WindNinja's momentum solver on it, keeps the u and v grids, and goes on to
  the next, until none are left. Any number of machines can share a kit in a
  synced folder; give one of them -Reverse and they meet in the middle.

    powershell -ExecutionPolicy Bypass -File run.ps1 [-Reverse] [-Threads 8] [-Cli path\WindNinja_cli.exe]

  WindNinja: -Cli, else WINDNINJA_CLI, else C:\tmp\windninja\app\bin, else the
  kit's windninja-app.zip unpacked into %LOCALAPPDATA%\windcfd-app.
#>
param(
  [switch]$Reverse,
  [int]$Threads = 0,
  [string]$Cli = ''
)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$kit = $PSScriptRoot
# the machine and this runner: two runners on one machine overlap WindNinja's
# single-threaded stretches (meshing, sampling), so each needs its own claim
$me = "$($env:COMPUTERNAME)-$PID"

function Find-Cli {
  if ($Cli -and (Test-Path $Cli)) { return $Cli }
  if ($env:WINDNINJA_CLI -and (Test-Path $env:WINDNINJA_CLI)) { return $env:WINDNINJA_CLI }
  $tmp = 'C:\tmp\windninja\app\bin\WindNinja_cli.exe'
  if (Test-Path $tmp) { return $tmp }
  $local = Join-Path $env:LOCALAPPDATA 'windcfd-app'
  $exe = Join-Path $local 'bin\WindNinja_cli.exe'
  if (Test-Path $exe) { return $exe }
  $zip = Join-Path $kit 'windninja-app.zip'
  if (-not (Test-Path $zip)) { throw "No WindNinja: pass -Cli, or put windninja-app.zip in the kit" }
  Write-Host "Unpacking WindNinja into $local (once)..."
  Expand-Archive -Path $zip -DestinationPath $local -Force
  if (-not (Test-Path $exe)) { throw "windninja-app.zip has no bin\WindNinja_cli.exe" }
  return $exe
}

if ($Threads -le 0) {
  $Threads = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
}
$cliPath = Find-Cli
$cliDir = Split-Path $cliPath

# the jobs: every area's 16 directions, coarse first (0, 180, 90, 270, 45, ...)
# so a half-done kit still has the compass covered, the areas taking turns
$order = @(0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15)
$areas = Get-ChildItem -Path $kit -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'meta.json') }
$jobs = @()
foreach ($k in $order) {
  foreach ($a in $areas) {
    $meta = Get-Content (Join-Path $a.FullName 'meta.json') -Raw | ConvertFrom-Json
    $d = [double]$meta.directions[$k]
    $jobs += [pscustomobject]@{ Area = $a.Name; Dir = $d; Mesh = [int]$meta.meshCount; Speed = [double]$meta.speedKph; Root = $a.FullName }
  }
}
if ($Reverse) { [array]::Reverse($jobs) }
Write-Host ("{0}: {1} jobs in the kit, {2} threads, WindNinja at {3}" -f $me, $jobs.Count, $Threads, $cliPath)

function Job-Dir($j) { Join-Path $j.Root ([string]::Format($inv, 'd{0:000.0}', $j.Dir)) }
function Is-Done($dir) { (Test-Path (Join-Path $dir 'done.txt')) }
function Is-Claimed($dir) { @(Get-ChildItem -Path $dir -Filter 'claim*.txt' -ErrorAction SilentlyContinue).Count -gt 0 }

foreach ($j in $jobs) {
  $dir = Job-Dir $j
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if ((Is-Done $dir) -or (Is-Claimed $dir)) { continue }
  # claim it, give a synced folder a moment, and back off if someone else did too
  Set-Content -Path (Join-Path $dir "claim-$me.txt") -Value ("{0} {1:s}" -f $me, (Get-Date)) -Encoding ascii
  Start-Sleep -Seconds 20
  $claims = @(Get-ChildItem -Path $dir -Filter 'claim*.txt')
  if ($claims.Count -gt 1 -and ($claims | Sort-Object Name | Select-Object -First 1).Name -ne "claim-$me.txt") {
    Remove-Item (Join-Path $dir "claim-$me.txt") -Force
    continue
  }
  # WindNinja builds its OpenFOAM case beside the DEM, and the bundled
  # OpenFOAM (a mingw port) hangs on a \\server\share path: from a kit on the
  # network, solve in a local copy and bring back only the grids
  $remote = $kit.StartsWith('\\')
  if ($remote) {
    $work = Join-Path (Join-Path $env:LOCALAPPDATA 'windcfd-work') $j.Area
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $dem = Join-Path $work 'dem.tif'
    $src = Join-Path $j.Root 'dem.tif'
    if (-not (Test-Path $dem) -or (Get-Item $dem).Length -ne (Get-Item $src).Length) { Copy-Item $src $dem -Force }
    $outDir = Join-Path $work (Split-Path $dir -Leaf)
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  } else {
    $dem = Join-Path $j.Root 'dem.tif'
    $outDir = $dir
  }
  $cfg = Join-Path $outDir 'run.cfg'
  $lines = @(
    "num_threads = $Threads",
    "elevation_file = $dem",
    'initialization_method = domainAverageInitialization',
    [string]::Format($inv, 'input_speed = {0:0.0}', $j.Speed),
    'input_speed_units = kph',
    'output_speed_units = kph',
    [string]::Format($inv, 'input_direction = {0:0.0}', $j.Dir),
    'input_wind_height = 10.0',
    'units_input_wind_height = m',
    'output_wind_height = 10.0',
    'units_output_wind_height = m',
    'vegetation = trees',
    'diurnal_winds = false',
    'momentum_flag = true',
    "mesh_count = $($j.Mesh)",
    'number_of_iterations = 300',
    'write_ascii_output = true',
    'ascii_out_uv = true',
    'ascii_out_resolution = 30.0',
    'units_ascii_out_resolution = m',
    "output_path = $outDir"
  )
  Set-Content -Path $cfg -Value $lines -Encoding ascii
  if ($remote) { Copy-Item $cfg (Join-Path $dir 'run.cfg') -Force }
  $log = Join-Path $dir "run-$me.log"
  $t0 = Get-Date
  Write-Host ("{0:HH:mm} {1} {2}° starting" -f $t0, $j.Area, [string]::Format($inv, '{0:0.0}', $j.Dir))
  $env:CPL_DEBUG = 'NINJAFOAM'
  Push-Location $cliDir
  try {
    $p = Start-Process -FilePath $cliPath -ArgumentList "`"$cfg`"" -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    $code = $p.ExitCode
  } finally { Pop-Location }
  # the run's OpenFOAM case, left beside the DEM and named for its process:
  # a few GB, and only this run's (another runner may be solving beside it)
  Get-ChildItem -Path (Split-Path $dem) -Directory -Filter "NINJAFOAM_*_$($p.Id)_*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  $u = @(Get-ChildItem -Path $outDir -Filter '*_u.asc')
  $v = @(Get-ChildItem -Path $outDir -Filter '*_v.asc')
  $mins = ((Get-Date) - $t0).TotalMinutes
  if ($code -eq 0 -and $u.Count -gt 0 -and $v.Count -gt 0) {
    # only u and v are read back (build_windcfd.py collect)
    Get-ChildItem -Path $outDir -Include '*_ang.asc', '*_vel.asc', '*_ang.prj', '*_vel.prj' -Recurse | Remove-Item -Force
    if ($remote) {
      Get-ChildItem -Path $outDir -Include '*_u.asc', '*_v.asc', '*_u.prj', '*_v.prj' -Recurse | Copy-Item -Destination $dir -Force
      Remove-Item $outDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Set-Content -Path (Join-Path $dir 'done.txt') -Value ([string]::Format($inv, '{0} {1:0.0} min', $me, $mins)) -Encoding ascii
    Write-Host ([string]::Format($inv, '{0:HH:mm} {1} {2:0.0}° done in {3:0.0} min', (Get-Date), $j.Area, $j.Dir, $mins))
  } else {
    Rename-Item (Join-Path $dir "claim-$me.txt") "failed-$me.txt" -Force
    Write-Host ([string]::Format($inv, '{0:HH:mm} {1} {2:0.0}° FAILED (exit {3}); see {4}', (Get-Date), $j.Area, $j.Dir, $code, $log))
  }
}
Write-Host "$me : no jobs left to claim."
