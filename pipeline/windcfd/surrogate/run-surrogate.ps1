<#
  The surrogate net's GPU runner (pipeline/surrogate/remote.py writes its
  jobs). Works through the kit's jobs one at a time: claims one nobody has,
  runs code\<script> with the job's arguments on this machine's own copy of
  the kit's Python, code and data, copies every file the run wrote or
  changed into the job's out\ folder, and goes on to the next, until none
  are left. One runner per machine is enough: the GPU takes one job at a time.

    powershell -ExecutionPolicy Bypass -File run-surrogate.ps1 [-Watch] [-PollMinutes 2] [-AtLogon] [-Restart]

  -Watch:    when nothing is left to claim, look again every -PollMinutes (2)
             instead of stopping. A runner only looks while it is idle.
  -AtLogon:  register a task that starts this hidden and watching whenever
             you sign in, and start that hidden runner now, so the window can
             be closed. Its lines go to %LOCALAPPDATA%\groundwind-surrogate\logs.
  -Restart:  first stop this machine's runners where they are (their python
             goes with them), give back the jobs they had claimed and clear
             any drain file, then start afresh. For a new run-surrogate.ps1: a
             runner reads it once, when it starts, so the ones going keep the
             old one until stopped.

  It won't double up: if a runner is already going on this machine, it says
  so and starts none. At its start a runner gives back this machine's claims
  that no runner holds any more (a reboot mid-job leaves one behind).

  The kit is this script's folder. The work happens in
  %LOCALAPPDATA%\groundwind-surrogate: python\ (mirrored from the kit's when
  its VERSION differs, about 5 GB the first time), code\ (mirrored before
  every job), data\ (the kit's newer files copied in and nothing deleted, so
  what the runs here wrote stays) and logs\ (this runner's own lines).

  A job is jobs\<id>\job.json: {"script", "argv", "needs", "created", ...};
  the oldest created goes first, and the runner adds --data itself. Python's
  output goes to jobs\<id>\run-<machine>-<pid>.log as it runs; then out\
  gets the files, and done.txt comes last. A failed run renames its claim
  failed-<machine>-<stamp>.txt and keeps the log; no runner takes the job
  again until that file is deleted.

  Drain: a file drain-<COMPUTERNAME>.txt in the kit makes this machine's
  runner finish the job in hand and stop.
#>
param(
  [switch]$Watch,
  [int]$PollMinutes = 2,
  [switch]$AtLogon,
  [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$kit = $PSScriptRoot
$machine = $env:COMPUTERNAME
$me = "$machine-$PID"
$work = Join-Path $env:LOCALAPPDATA 'groundwind-surrogate'
$logDir = Join-Path $work 'logs'
$jobsDir = Join-Path $kit 'jobs'
$drain = Join-Path $kit "drain-$machine.txt"
$taskName = 'Groundwind surrogate runner'
# one encoding in a job's log, header and python alike: UTF-8 without a BOM
# (python writes it under -X utf8; remote.py wait tails the log)
$utf8 = New-Object Text.UTF8Encoding $false
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Say([string]$msg) {
  Write-Host $msg
  # a hidden runner has no window: its lines are only here
  $f = Join-Path $logDir ("runner-{0:yyyyMMdd}.log" -f (Get-Date))
  try { [IO.File]::AppendAllText($f, ("{0:s} {1} {2}`r`n" -f (Get-Date), $me, $msg), $utf8) } catch { }
}

# this script's other processes on this machine: not this one, nor the one
# that started it (-AtLogon starts the hidden runner and is still closing)
function Get-Runners {
  $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
  return ,@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object {
    $_.CommandLine -match 'run-surrogate\.ps1' -and $_.ProcessId -ne $PID -and $_.ProcessId -ne $parent
  })
}

# the whole tree: runner, cmd and python. Walked by parent, a child only if
# it started after its parent (a pid can be reused), stopped children first,
# with Stop-Process rather than taskkill (start-runners.ps1 says why)
function Stop-Tree($p) {
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
    Say ("runner pid {0}: {1} process(es) would not stop: {2}" -f $p.ProcessId, $left.Count, (($left | ForEach-Object { "$($_.Name) $($_.ProcessId)" }) -join ', '))
  } else {
    Say ("stopped runner pid {0} ({1} processes)" -f $p.ProcessId, $tree.Count)
  }
}

# this machine's claims on jobs not finished, other than this runner's own,
# go back to the pile. Only called when no other runner is going here, so
# every such claim is a dead one (stopped, or the machine went down mid-job)
function Give-Back {
  $pat = '^claim-' + [regex]::Escape($machine) + '-\d+$'
  foreach ($d in @(Get-ChildItem -Path $jobsDir -Directory -ErrorAction SilentlyContinue)) {
    if (Test-Path (Join-Path $d.FullName 'done.txt')) { continue }
    foreach ($c in @(Get-ChildItem -Path $d.FullName -Filter 'claim-*.txt' -ErrorAction SilentlyContinue)) {
      if ($c.BaseName -notmatch $pat -or $c.Name -eq "claim-$me.txt") { continue }
      $to = Join-Path $d.FullName ($c.Name -replace '^claim-', 'stopped-')
      if (Test-Path $to) { Remove-Item $to -Force }
      Rename-Item $c.FullName (Split-Path $to -Leaf)
      Say "gave back $($d.Name)"
    }
  }
}

# robocopy's exit code: 0-7 copied or nothing to do, 8 and up failed. Only
# its stdout is taken (all it writes): Windows PowerShell turns a native
# tool's stderr into an error (run.ps1)
function Robo([string]$from, [string]$to, [string[]]$opts) {
  $out = @(& robocopy $from $to @opts /R:3 /W:5 /NP /NFL /NDL /NJH /NJS)
  if ($LASTEXITCODE -ge 8) { throw ("robocopy {0} -> {1} failed (exit {2}): {3}" -f $from, $to, $LASTEXITCODE, (($out | Where-Object { $_.Trim() } | Select-Object -Last 3) -join ' / ')) }
}

function Sync-Local {
  $kPy = Join-Path $kit 'python'
  $lPy = Join-Path $work 'python'
  $kv = Join-Path $kPy 'VERSION'
  if (-not (Test-Path $kv)) { throw "the kit has no python\VERSION" }
  $want = (Get-Content $kv -Raw).Trim()
  $lv = Join-Path $lPy 'VERSION'
  $have = ''
  if (Test-Path $lv) { $have = (Get-Content $lv -Raw).Trim() }
  if ($want -ne $have) {
    Say "python $want is new here; copying it into $lPy..."
    $t = Get-Date
    # VERSION last, so a copy cut short is done again next time
    Robo $kPy $lPy @('/MIR', '/MT:16', '/XF', 'VERSION')
    Copy-Item $kv $lv -Force
    Say ([string]::Format($inv, 'python copied in {0:0.0} min', ((Get-Date) - $t).TotalMinutes))
  }
  # the bytecode python leaves beside the code is its own: kept, not purged
  Robo (Join-Path $kit 'code') (Join-Path $work 'code') @('/MIR', '/XD', '__pycache__')
  Robo (Join-Path $kit 'data') (Join-Path $work 'data') @('/E', '/XO')
}

$unreadable = @{}
function Get-Jobs {
  $list = @()
  foreach ($d in @(Get-ChildItem -Path $jobsDir -Directory -ErrorAction SilentlyContinue)) {
    # job.json arrives by write-then-rename: a folder without one is still coming
    $f = Join-Path $d.FullName 'job.json'
    if (-not (Test-Path $f)) { continue }
    try {
      $j = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.created -is [DateTime]) { $when = $j.created.ToUniversalTime() }
      else { $when = [DateTimeOffset]::Parse([string]$j.created, $inv).UtcDateTime }
    } catch {
      if (-not $unreadable.ContainsKey($d.Name)) { Say "$($d.Name): job.json unreadable, skipped ($($_.Exception.Message))" }
      $unreadable[$d.Name] = 1
      continue
    }
    $list += [pscustomobject]@{ Id = $d.Name; Dir = $d.FullName; Job = $j; Created = $when }
  }
  return ,@($list | Sort-Object Created, Id)
}

function Is-Free($dir) {
  if (Test-Path (Join-Path $dir 'done.txt')) { return $false }
  if (@(Get-ChildItem -Path $dir -Filter 'failed-*.txt').Count) { return $false }
  if (@(Get-ChildItem -Path $dir -Filter 'claim*.txt').Count) { return $false }
  return $true
}

# every file under the local data folder, by its time and size, to tell
# afterwards what the run wrote or changed: by the files themselves rather
# than by the clock, since the kit's files carry the other machine's times
function Snap([string]$root) {
  $h = @{}
  foreach ($f in @(Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue)) {
    $h[$f.FullName] = "$($f.LastWriteTimeUtc.Ticks)|$($f.Length)"
  }
  return $h
}

function Fail-Job($j, [string]$claim, [string]$why) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $failed = "failed-$machine-$stamp.txt"
  Rename-Item $claim $failed
  Add-Content -Path (Join-Path $j.Dir $failed) -Value $why -Encoding ascii
  Say ("{0:HH:mm} {1} FAILED: {2}" -f (Get-Date), $j.Id, $why)
}

# one job: claim it, bring the local copy up to date, run it, hand back its
# files. $true if this runner took it, $false if it backed off
function Run-Job($j) {
  $dir = $j.Dir
  $claim = Join-Path $dir "claim-$me.txt"
  Set-Content -Path $claim -Value ("{0} {1:s}" -f $me, (Get-Date)) -Encoding ascii
  # give the share a moment, and back off if someone else claimed it too
  Start-Sleep -Seconds 20
  $claims = @(Get-ChildItem -Path $dir -Filter 'claim*.txt')
  if ($claims.Count -gt 1 -and ($claims | Sort-Object Name | Select-Object -First 1).Name -ne "claim-$me.txt") {
    Remove-Item $claim -Force
    return $false
  }
  $log = Join-Path $dir "run-$me.log"
  $py = Join-Path $work 'python\python.exe'
  $code = Join-Path $work 'code'
  $data = Join-Path $work 'data'
  try {
    Sync-Local
  } catch {
    # the kit or this disk let us down, not the job: it goes back to the pile
    try {
      $to = Join-Path $dir "stopped-$me.txt"
      if (Test-Path $to) { Remove-Item $to -Force }
      Rename-Item $claim (Split-Path $to -Leaf)
    } catch { }
    throw
  }

  $job = $j.Job
  $script = [string]$job.script
  $argv = @()
  if ($null -ne $job.argv) { $argv = @($job.argv | ForEach-Object { [string]$_ }) }
  $needs = @()
  if ($null -ne $job.needs) { $needs = @($job.needs | ForEach-Object { [string]$_ }) }
  # cmd runs the line below: a quote, % or ! in it would be read by cmd, not
  # passed on (all the scripts' arguments are names and numbers)
  $why = $null
  if ($script -notmatch '^[\w.-]+\.py$' -or -not (Test-Path (Join-Path $code $script))) { $why = "no script '$script' in code\" }
  foreach ($a in $argv) {
    if ($a -match '["%!\r\n]') { $why = "argument $a has a character cmd would read" }
    elseif ($a -eq '--data') { $why = 'the job carries --data; the runner adds it' }
  }
  foreach ($n in $needs) {
    if ($n -match '\.\.' -or -not (Test-Path (Join-Path $data $n))) { $why = "needs $n, which the kit's data\ does not have" }
  }
  if ("$py$code$data$log" -match '[%!]') { $why = 'a path here has a % or !, which cmd would read' }

  $parts = @("`"$py`"", '-s', '-u', '-X', 'utf8', "`"$(Join-Path $code $script)`"") + @($argv | ForEach-Object { "`"$_`"" }) + @('--data', "`"$data`"")
  $cmdLine = $parts -join ' '
  $t0 = Get-Date
  [IO.File]::AppendAllText($log, ("=== {0:s} {1} in {2}: {3}`r`n" -f $t0, $me, $code, $cmdLine), $utf8)
  if ($why) {
    [IO.File]::AppendAllText($log, "=== not run: $why`r`n", $utf8)
    Fail-Job $j $claim $why
    return $true
  }
  Say ("{0:HH:mm} {1} starting: {2} {3}" -f $t0, $j.Id, $script, ($argv -join ' '))
  $before = Snap $data
  # -s: the user's own site-packages stay out (python314._pth keeps out
  # PYTHONPATH and the like, not those); -u: unbuffered, since train.py
  # flushes only its step lines and the log is what remote.py tails.
  # AboveNormal through cmd's start: WindNinja's runners hold every core on
  # xonix, and the trainer's data loader needs one of them
  $line = "/d /s /v:on /c `"start `"`" /b /wait /abovenormal $cmdLine >> `"$log`" 2>&1 & exit !errorlevel!`""
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList $line -WorkingDirectory $code -NoNewWindow -Wait -PassThru
  $exit = $p.ExitCode
  $mins = ((Get-Date) - $t0).TotalMinutes
  [IO.File]::AppendAllText($log, [string]::Format($inv, "=== {0:s} exit {1} after {2:0.0} min`r`n", (Get-Date), $exit, $mins), $utf8)
  if ($exit -ne 0) {
    Fail-Job $j $claim ([string]::Format($inv, 'exit {0} after {1:0.0} min; see run-{2}.log', $exit, $mins, $me))
    return $true
  }
  try {
    $out = Join-Path $dir 'out'
    $n = 0
    foreach ($f in @(Get-ChildItem -Path $data -Recurse -File)) {
      if ($before[$f.FullName] -eq "$($f.LastWriteTimeUtc.Ticks)|$($f.Length)") { continue }
      $dst = Join-Path $out $f.FullName.Substring($data.Length).TrimStart('\')
      New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
      Copy-Item $f.FullName $dst -Force
      $n++
    }
    # done.txt last and whole (written, then renamed): remote.py collects
    # out\ the moment it sees it
    $tmp = Join-Path $dir "done-$me.tmp"
    Set-Content -Path $tmp -Value ([string]::Format($inv, '{0} {1:0.0} min', $me, $mins)) -Encoding ascii
    Rename-Item $tmp 'done.txt'
  } catch {
    Fail-Job $j $claim "ran, but its files did not reach out\: $($_.Exception.Message)"
    return $true
  }
  Say ([string]::Format($inv, '{0:HH:mm} {1} done in {2:0.0} min, {3} file(s) in out\', (Get-Date), $j.Id, $mins, $n))
  return $true
}

function Run-Loop {
  Say ("{0}: kit {1}, work in {2}{3}" -f $me, $kit, $work, $(if ($Watch) { ", looking every $PollMinutes min" } else { '' }))
  Give-Back
  do {
    $ran = 0
    try {
      foreach ($j in (Get-Jobs)) {
        if (Test-Path $drain) { break }
        if (-not (Is-Free $j.Dir)) { continue }
        if (Run-Job $j) { $ran++ }
      }
    } catch {
      # the kit out of reach, a full disk: say so, and when watching try again later
      Say ("{0:HH:mm} error: {1}" -f (Get-Date), $_.Exception.Message)
      if (-not $Watch) { throw }
      $ran = 0
    }
    if (Test-Path $drain) { Say ("{0:HH:mm} {1}: drained" -f (Get-Date), $me); return }
    # ran something: look again at once (more may have come meanwhile);
    # found nothing: wait, then look again
    if ($Watch -and $ran -eq 0) { Start-Sleep -Seconds ([math]::Max(1, $PollMinutes) * 60) }
  } while ($Watch)
  Say "$me : no jobs left to claim."
}

if ($Restart) {
  foreach ($p in (Get-Runners)) { Stop-Tree $p }
  if ((Get-Runners).Count -eq 0) { Give-Back }
  Remove-Item $drain -Force -ErrorAction SilentlyContinue
}

$going = Get-Runners
if ($going.Count -gt 0) {
  Say ("a runner is already going on {0} (pid {1}); starting none." -f $machine, (($going | ForEach-Object { $_.ProcessId }) -join ', '))
} elseif ($AtLogon) {
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"", '-Watch', '-PollMinutes', "$PollMinutes")
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden -PassThru
  Say "started the runner hidden, pid $($p.Id), looking every $PollMinutes min. Its lines: $logDir"
} else {
  Run-Loop
}

if ($AtLogon) {
  $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Watch -PollMinutes $PollMinutes"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Say "Registered '$taskName' to start at sign-in. Remove it with: Unregister-ScheduledTask -TaskName '$taskName'"
}
