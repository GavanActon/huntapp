<#
  Starts this machine's momentum-solve runners on the kit, hidden, each one
  watching for new work every few minutes once the kit runs dry, so a new
  area's kit (build_windcfd.py prepare) is picked up with nobody at the keys.

    powershell -ExecutionPolicy Bypass -File start-runners.ps1 [-Threads "24,8,6"] [-Reverse] [-PollMinutes 5] [-AtLogon]

  -Threads: one runner per number, each with that many threads. Default:
            as many 4-thread runners as the machine has room for (cores,
            free RAM, free disk). Many small runners beat a few big ones:
            about a third of a job is single-threaded (meshing, sampling,
            reconstructing), and the MPI solve scales poorly on Windows.
            On xonix, 24 threads ran a job in 29 min and 6 threads in 39,
            so four 6-thread runners do ~3x the jobs of one 24-thread one.
  -Reverse: take the job list from the back (one machine forward, one back).
  -AtLogon: also register a task that runs this again whenever you sign in.
  -Restart: first stop this machine's runners where they are (their WindNinja
            and its OpenFOAM go with them), give back the jobs they had
            claimed, clear their half-built cases and any drain file, then
            start afresh. For a new run.ps1: a runner reads it once, when it
            starts, so the ones going keep the old one until stopped.

  It won't double up: if runners started by it are already watching on this
  machine, it says so and starts none. To change the mix, put an empty
  drain-<COMPUTERNAME>.txt in the kit: this machine's runners finish the job
  in hand and stop. Then delete it and run this again.
  Logs go to %LOCALAPPDATA%\windcfd-logs.
#>
param(
  [string]$Threads = '',
  [switch]$Reverse,
  [int]$PollMinutes = 5,
  [switch]$AtLogon,
  [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
$run = Join-Path $kit 'run.ps1'
$logDir = Join-Path $env:LOCALAPPDATA 'windcfd-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if ($Restart) {
  $old = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'run\.ps1' -and $_.ProcessId -ne $PID })
  foreach ($p in $old) {
    # the whole tree: runner, WindNinja, mpiexec, smpd and the solver ranks.
    # Walked by parent, a child only if it started after its parent (a pid
    # can be reused), and stopped children first. Stop-Process, not
    # taskkill: Windows PowerShell turns a native tool's stderr into an
    # error, and one child already gone stopped the whole restart (xonix,
    # 2026-10-05)
    $all = @(Get-CimInstance Win32_Process)
    $tree = @($p)
    for ($i = 0; $i -lt $tree.Count; $i++) {
      $tree += @($all | Where-Object { $_.ParentProcessId -eq $tree[$i].ProcessId -and $_.CreationDate -ge $tree[$i].CreationDate })
    }
    [array]::Reverse($tree)
    foreach ($q in $tree) {
      try { Stop-Process -Id $q.ProcessId -Force -ErrorAction Stop } catch { }
    }
    Start-Sleep -Seconds 2
    $left = @($tree | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    if ($left.Count) {
      Write-Host ("runner pid {0}: {1} process(es) would not stop: {2}" -f $p.ProcessId, $left.Count, (($left | ForEach-Object { "$($_.Name) $($_.ProcessId)" }) -join ', '))
    } else {
      Write-Host ("stopped runner pid {0} ({1} processes)" -f $p.ProcessId, $tree.Count)
    }
  }
  # claims of this machine's runners that are no longer running (these, or
  # ones stopped before by hand or by a restart that failed partway), on
  # jobs not finished, go back to the pile
  $alive = @(Get-Process | ForEach-Object { $_.Id })
  Get-ChildItem -Path $kit -Recurse -Depth 2 -Filter "claim-$($env:COMPUTERNAME)-*.txt" -ErrorAction SilentlyContinue | Where-Object {
    -not (Test-Path (Join-Path $_.DirectoryName 'done.txt')) -and $_.BaseName -match '-(\d+)$' -and $alive -notcontains [int]$Matches[1]
  } | ForEach-Object {
    Rename-Item $_.FullName ($_.Name -replace '^claim-', 'stopped-') -Force
    Write-Host ("gave back {0}\{1}" -f (Split-Path $_.DirectoryName -Parent | Split-Path -Leaf), (Split-Path $_.DirectoryName -Leaf))
  }
  if ($old.Count) {
    Start-Sleep -Seconds 3
    # the cases they were solving: beside the kit's DEMs when the kit is on
    # this machine, else in the local work copy (never the share's: those
    # are the host's own runs)
    $roots = @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'windcfd-work') -Directory -ErrorAction SilentlyContinue)
    if (-not $kit.StartsWith('\\')) { $roots += @(Get-ChildItem -Path $kit -Directory) }
    foreach ($r in $roots) {
      Get-ChildItem -Path $r.FullName -Directory -Filter 'NINJAFOAM_*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item (Join-Path $kit "drain-$($env:COMPUTERNAME).txt") -Force -ErrorAction SilentlyContinue
}

if ($Threads) {
  $counts = $Threads.Split(',') | ForEach-Object { [int]$_.Trim() } | Where-Object { $_ -gt 0 }
} else {
  # a 4-thread job keeps ~2.3 cores busy on average (a third of it on one
  # thread), and its OpenFOAM case takes ~1.7 GB of disk (more while
  # meshing) beside the DEM, or under %LOCALAPPDATA% when the kit is on a
  # share. RAM: WindNinja itself peaks near 2.7 GB writing its output since
  # the turbulence (the Google Earth file at 30 m), so 3 GB are allowed.
  # Runners started together write together: xonix's ten at 2 GB each lost
  # two runs that way, crashing mid-write (2026-10-05). Memory is what
  # Windows calls available (free + standby), less 2 GB for everything
  # else on the machine.
  $cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
  $freeGB = (Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue / 1KB
  $work = if ($kit.StartsWith('\')) { $env:LOCALAPPDATA } else { $kit }
  $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f (Split-Path $work -Qualifier))
  $diskGB = $disk.FreeSpace / 1GB
  $n = [math]::Floor($cores / 2.3)
  $n = [math]::Min($n, [math]::Floor(($freeGB - 2) / 3))
  $n = [math]::Min($n, [math]::Floor($diskGB / 4))
  $n = [math]::Max(1, $n)
  $counts = @(4) * $n
  Write-Host ("{0}: {1} cores, {2:N0} GB RAM available, {3:N0} GB disk free -> {4} runners of 4 threads" -f $env:COMPUTERNAME, $cores, $freeGB, $diskGB, $n)
}

$watching = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'run\.ps1' -and $_.CommandLine -match '-Watch' })
if ($watching.Count -gt 0) {
  Write-Host "$($watching.Count) runner(s) already watching on $env:COMPUTERNAME; starting none."
} else {
  $i = 0
  foreach ($n in $counts) {
    $i++
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$run`"", '-Watch', '-PollMinutes', "$PollMinutes", '-Threads', "$n")
    if ($Reverse) { $args += '-Reverse' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logDir "runner$i-$stamp.log") -RedirectStandardError (Join-Path $logDir "runner$i-$stamp.err")
    Write-Host ("runner {0}: {1} threads, pid {2}" -f $i, $n, $p.Id)
    Start-Sleep -Seconds 25  # let each claim its first job before the next looks
  }
  Write-Host "Logs: $logDir"
}

if ($AtLogon) {
  $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Threads `"$($counts -join ',')`" -PollMinutes $PollMinutes"
  if ($Reverse) { $argLine += ' -Reverse' }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'Groundwind WindNinja runners' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Registered 'Groundwind WindNinja runners' to start at sign-in. Remove it with: Unregister-ScheduledTask -TaskName 'Groundwind WindNinja runners'"
}
