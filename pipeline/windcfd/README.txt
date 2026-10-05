Groundwind momentum solve kit (pipeline/build_windcfd.py)

What it is: WindNinja's momentum solver (OpenFOAM) run over each area for
16 wind directions, for the ground wind's terrain layer. Each run is one
area at one direction, and takes up to an hour.

To help from another Windows machine:
  1. Reach this folder from that machine: a network share of it, or a copy.
  2. Open PowerShell in this folder and run:
       powershell -ExecutionPolicy Bypass -File run.ps1 -Reverse
     The first time, it unpacks WindNinja from windninja-app.zip (no install).
  3. Leave it running and plugged in. It takes the next job no one has
     claimed, so stop it any time (Ctrl+C) and the rest go to the others.

Each job folder (<area>\d<direction>) ends up with done.txt and the u and v
grids. A claim-<machine>.txt with no done.txt means that machine is on it.
A failed-<machine>.txt means it failed there, and another machine may retry
it. If a machine is switched off mid-run, delete its claim file so the job
can be run again.
