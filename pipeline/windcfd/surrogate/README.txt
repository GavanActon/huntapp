Groundwind surrogate GPU kit (pipeline/surrogate/remote.py)

What it is: the surrogate net's training and prediction runs (train.py,
predict.py, eval.py), sent here by remote.py on XEVO for a machine with a
bigger GPU. It carries its own Python with torch for CUDA 12.8 (python\, no
install), the scripts (code\) and the areas and checkpoints they read
(data\). The WindNinja runners one folder up leave it alone.

To run the jobs on xonix (or any Windows machine with an NVIDIA driver of
570 or later):
  1. Reach this folder from that machine: \\XEVO\windcfd2\surrogate.
  2. Run, in PowerShell:
       powershell -ExecutionPolicy Bypass -File \\XEVO\windcfd2\surrogate\run-surrogate.ps1 -Watch -AtLogon
     It starts the runner hidden, looking for new jobs every 2 minutes, and
     -AtLogon starts it again at every sign-in. One runner per machine: the
     GPU takes one job at a time, and a second start says so and does nothing.
     The first job waits while the kit's Python (about 5 GB) is copied to
     %LOCALAPPDATA%\groundwind-surrogate; after that only what changed is.
     One runner by hand, in this window, stopping when the kit is empty:
       powershell -ExecutionPolicy Bypass -File run-surrogate.ps1 [-Watch]
  3. Leave it running and plugged in. The GPU job runs at above-normal
     priority, so it gets its core beside the WindNinja runners.

Logs: the runner's own lines in %LOCALAPPDATA%\groundwind-surrogate\logs
(one file a day); each job's Python output in its folder here,
jobs\<id>\run-<machine>-<pid>.log, written as it runs.

To stop or change it: an empty drain-<COMPUTERNAME>.txt in this folder makes
that machine's runner finish the job in hand and stop. When run-surrogate.ps1
changes, a runner keeps the one it started with: run it again with -Restart
(plus -Watch -AtLogon): it stops this machine's runner where it is, gives its
job back and starts a fresh one.

Each job folder (jobs\<id>) has job.json, and in time a claim-<machine>-<pid>.txt
(that machine is on it), the run's log, out\ (every file the run wrote, by
its path under data\) and done.txt last. A failed-<machine>-<stamp>.txt means
it failed there (the log says why); no runner takes it again until that file
is deleted. A stopped- file is a claim given back. If a machine is switched
off mid-run, its runner gives the job back when it next starts; or delete
the claim file so another machine can run it.
