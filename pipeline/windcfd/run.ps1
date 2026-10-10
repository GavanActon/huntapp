<#
  The momentum solve's runner (pipeline/build_windcfd.py). Works through the
  kit's jobs, one (area, direction) at a time: claims one nobody has, runs
  WindNinja's momentum solver on it, keeps the u and v grids and the
  turbulence (the velocity fluctuation's most in the lowest 10 m), and goes
  on to the next, until none are left. Any number of machines can share a kit
  in a synced folder; give one of them -Reverse and they meet in the middle.

  A job is <area>\t<direction>. The d<direction> folders from before
  2026-10-05 were the first pass, u and v only, kept for reference.
  An area's meta.json "priority" (default 0) puts it first: a higher one's
  jobs all come before a lower one's.

    powershell -ExecutionPolicy Bypass -File run.ps1 [-Reverse] [-Threads 8] [-Cli path\WindNinja_cli.exe] [-Watch] [-PollMinutes 5]

  -Watch: when nothing is left to claim, look again every -PollMinutes (5)
  for new work (a new area's kit, a released hold) instead of stopping. A
  runner only looks while it is idle: it never takes a second job at once.

  Drain: a file drain-<COMPUTERNAME>.txt in the kit makes this machine's
  runners finish the job in hand and stop, so the mix can be changed
  (start-runners.ps1) without throwing away a run half done.

  WindNinja: -Cli, else WINDNINJA_CLI, else C:\tmp\windninja\app\bin, else the
  kit's windninja-app.zip unpacked into %LOCALAPPDATA%\windcfd-app.
#>
param(
  [switch]$Reverse,
  [int]$Threads = 0,
  [string]$Cli = '',
  [switch]$Watch,
  [int]$PollMinutes = 5
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
# within a priority. -Reverse goes from the back within each priority, so
# two machines still meet in the middle of the first area.
# Read afresh on every pass, so a watching runner finds a new area's kit.
$order = @(0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15)
function Get-Jobs {
  $areas = @(Get-ChildItem -Path $kit -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'meta.json') } | ForEach-Object {
    $meta = Get-Content (Join-Path $_.FullName 'meta.json') -Raw | ConvertFrom-Json
    $pri = if ($null -ne $meta.priority) { [int]$meta.priority } else { 0 }
    [pscustomobject]@{ Dir = $_; Meta = $meta; Priority = $pri }
  })
  $list = @()
  foreach ($grp in ($areas | Group-Object Priority | Sort-Object { [int]$_.Name } -Descending)) {
    $part = @()
    foreach ($k in $order) {
      foreach ($a in $grp.Group) {
        $d = [double]$a.Meta.directions[$k]
        $part += [pscustomobject]@{ Area = $a.Dir.Name; Dir = $d; Mesh = [int]$a.Meta.meshCount; Speed = [double]$a.Meta.speedKph; Root = $a.Dir.FullName }
      }
    }
    if ($Reverse) { [array]::Reverse($part) }
    $list += $part
  }
  return ,$list
}
$jobs = Get-Jobs
Write-Host ("{0}: {1} jobs in the kit, {2} threads, WindNinja at {3}{4}" -f $me, $jobs.Count, $Threads, $cliPath, $(if ($Watch) { ", watching every $PollMinutes min" } else { '' }))

function Job-Dir($j) { Join-Path $j.Root ([string]::Format($inv, 't{0:000.0}', $j.Dir)) }
function Is-Done($dir) { (Test-Path (Join-Path $dir 'done.txt')) }
function Is-Claimed($dir) { @(Get-ChildItem -Path $dir -Filter 'claim*.txt' -ErrorAction SilentlyContinue).Count -gt 0 }

$drain = Join-Path $kit "drain-$($env:COMPUTERNAME).txt"
do {
$ran = 0
foreach ($j in $jobs) {
  if (Test-Path $drain) { break }
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
  $ran++
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
    # the turbulence comes out only beside a Google Earth file: a GeoTIFF
    # (EPSG:4326) of the column's most velocity fluctuation, in km/h, over
    # the height COLMAX_HEIGHT_AGL (set below; WindNinja's own is 457 m)
    'write_goog_output = true',
    'goog_out_resolution = 30.0',
    'units_goog_out_resolution = m',
    'turbulence_output_flag = true',
    "output_path = $outDir"
  )
  Set-Content -Path $cfg -Value $lines -Encoding ascii
  if ($remote) { Copy-Item $cfg (Join-Path $dir 'run.cfg') -Force }
  $log = Join-Path $dir "run-$me.log"
  $t0 = Get-Date
  Write-Host ("{0:HH:mm} {1} {2}° starting" -f $t0, $j.Area, [string]::Format($inv, '{0:0.0}', $j.Dir))
  $env:CPL_DEBUG = 'NINJAFOAM'
  $env:COLMAX_HEIGHT_AGL = '10'
  # from the job's own folder: WindNinja writes the turbulence's scratch
  # grid (colMax_10mColHeightAGL_raw_proj.tif) under one fixed name in the
  # current folder, so runners started from WindNinja's folder crashed each
  # other when two finished together ("Deleting ... failed: Permission
  # denied", xonix 2026-10-08 and -09). WindNinja finds its OpenFOAM beside
  # its own exe, not in the current folder (checked 2026-10-09)
  Push-Location $outDir
  try {
    $p = Start-Process -FilePath $cliPath -ArgumentList "`"$cfg`"" -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    $code = $p.ExitCode
  } finally { Pop-Location }
  # the run's OpenFOAM case, left beside the DEM and named for its process:
  # a few GB, and only this run's (another runner may be solving beside it)
  Get-ChildItem -Path (Split-Path $dem) -Directory -Filter "NINJAFOAM_*_$($p.Id)_*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  $u = @(Get-ChildItem -Path $outDir -Filter '*_u.asc')
  $v = @(Get-ChildItem -Path $outDir -Filter '*_v.asc')
  $k = @(Get-ChildItem -Path $outDir -Filter '*colMax*.tif')
  $mins = ((Get-Date) - $t0).TotalMinutes
  if ($code -eq 0 -and $u.Count -gt 0 -and $v.Count -gt 0 -and $k.Count -gt 0) {
    # only u, v and the turbulence are read back (build_windcfd.py collect)
    Get-ChildItem -Path $outDir -Include '*_ang.asc', '*_vel.asc', '*_ang.prj', '*_vel.prj', '*.kmz' -Recurse | Remove-Item -Force
    if ($remote) {
      Get-ChildItem -Path $outDir -Include '*_u.asc', '*_v.asc', '*_u.prj', '*_v.prj', '*colMax*.tif' -Recurse | Copy-Item -Destination $dir -Force
      Remove-Item $outDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Set-Content -Path (Join-Path $dir 'done.txt') -Value ([string]::Format($inv, '{0} {1:0.0} min', $me, $mins)) -Encoding ascii
    Write-Host ([string]::Format($inv, '{0:HH:mm} {1} {2:0.0}° done in {3:0.0} min', (Get-Date), $j.Area, $j.Dir, $mins))
  } else {
    # stamped, so a second failure on this runner neither collides with the
    # first (the rename threw and left the claim stuck, 2026-10-08) nor
    # writes over its log; the half-written local copy goes, so a retry
    # here starts clean
    $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
    Rename-Item (Join-Path $dir "claim-$me.txt") "failed-$me-$stamp.txt" -Force
    foreach ($f in @($log, "$log.err")) {
      if (Test-Path $f) { Rename-Item $f ((Split-Path $f -Leaf) -replace "^run-$me", "run-$me-$stamp") -Force }
    }
    $log = Join-Path $dir "run-$me-$stamp.log"
    if ($remote) { Remove-Item $outDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host ([string]::Format($inv, '{0:HH:mm} {1} {2:0.0}° FAILED (exit {3}); see {4}', (Get-Date), $j.Area, $j.Dir, $code, $log))
  }
}
if (Test-Path $drain) { Write-Host ("{0:HH:mm} {1}: drained" -f (Get-Date), $me); break }
if ($Watch) {
  # ran something: look again at once (new work may have come in meanwhile);
  # found nothing: wait, then look again
  if ($ran -eq 0) { Start-Sleep -Seconds ([math]::Max(1, $PollMinutes) * 60) }
  $jobs = Get-Jobs
}
} while ($Watch)
Write-Host "$me : no jobs left to claim."
