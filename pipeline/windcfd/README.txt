Groundwind momentum solve kit (pipeline/build_windcfd.py)

What it is: WindNinja's momentum solver (OpenFOAM) run over each area for
16 wind directions, for the ground wind's terrain layer. Each run is one
area at one direction, and takes up to an hour.

To help from another Windows machine:
  1. Reach this folder from that machine: a network share of it, or a copy.
  2. Open PowerShell in this folder and run:
       powershell -ExecutionPolicy Bypass -File start-runners.ps1 -Reverse -AtLogon
     It starts this machine's runners hidden (about 60/20/20 % of the cores,
     or -Threads "24,8,6"), each watching for new work every 5 minutes once
     the kit runs dry, and -AtLogon starts them again at every sign-in.
     The first time, WindNinja unpacks from windninja-app.zip (no install).
     One runner by hand, stopping when the kit is empty:
       powershell -ExecutionPolicy Bypass -File run.ps1 -Reverse [-Watch]
  3. Leave it running and plugged in. It takes the next job no one has
     claimed, so stop it any time and the rest go to the others.

When run.ps1 changes: a runner reads it once, as it starts, so the ones
going keep the old one. Run start-runners.ps1 with -Restart (plus the
-Reverse or -Threads it had): it stops this machine's runners where they
are, gives their jobs back and starts fresh ones.

Progress: status.html (the directions) and areas\index.html (every area's
checklist, with the directions live) in this folder; both reload themselves.
A job held back by hand has a claim-HOLD.txt: runners skip it until it's
deleted.

Each job folder (<area>\t<direction>) ends up with done.txt, the u and v
grids and the turbulence (a *colMax_10mColHeightAGL.tif). The d<direction>
folders are the first pass, from before 2026-10-05: u and v only. An area's
meta.json "priority" puts its jobs first (higher first; 0 if not set). A claim-<machine>.txt with no done.txt means that machine is on it.
A failed-<machine>.txt means it failed there, and another machine may retry
it. If a machine is switched off mid-run, delete its claim file so the job
can be run again.
