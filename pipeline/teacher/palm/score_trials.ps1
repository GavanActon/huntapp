# pipeline/teacher/palm/score_trials.ps1 (huntapp-c4, 2026-10-16). Waits for 88's SD v2 trial folders on R2 (v2t: the lee retrain; v2t2: the lee retrain + provincial wetlands),
# then scores HD + v1, v2t and v2t2 on one HEAD with the same patch, one after another (the worktree lock).
$s = 'C:\dev\huntapp\pipeline\raw\teacher\palm\scores\trial-logs'; New-Item -ItemType Directory -Force $s | Out-Null
$want = 't-628-410','t-629-410','t-628-411','t-629-411','t-735-405','t-736-405','t-735-406','t-736-406','t-660-418','t-661-418','t-660-419','t-661-419'
function ready($v) {
  try {
    $j = Invoke-RestMethod "https://data.groundwind.app/data/sd/$v/index.json?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -Headers @{ 'User-Agent' = 'groundwind-scorecard' }
    $have = @($want | Where-Object { $j.tiles.PSObject.Properties.Name -contains $_ })
    return $have.Count -eq $want.Count
  } catch { return $false }
}
$t0 = Get-Date
while (-not ((ready 'v2t') -and (ready 'v2t2'))) {
  if (((Get-Date) - $t0).TotalHours -gt 5) { Write-Output "gave up waiting after 5 h: v2t $(ready 'v2t'), v2t2 $(ready 'v2t2')"; exit 1 }
  Start-Sleep 120
}
Write-Output "both trial folders up at $(Get-Date -Format HH:mm)"
Set-Location C:\dev\huntapp
foreach ($r in @(@('both', 'v1', 'trial-v1'), @('sd', 'v2t', 'trial-v2t'), @('sd', 'v2t2', 'trial-v2t2'))) {
  py -3.14 pipeline\teacher\palm\scorecard.py --label $r[2] --grid $r[0] --sd-version $r[1] --patch pipeline\teacher\palm\sd-tiles.diff *> "$s\$($r[2]).log"
  Write-Output "== $($r[2]) exit $LASTEXITCODE"
  Get-Content "$s\$($r[2]).log" | Select-String -Pattern '^(base|testset)|left out|did not come' | ForEach-Object { $_.Line.Substring(0, [math]::Min(500, $_.Line.Length)) }
}
