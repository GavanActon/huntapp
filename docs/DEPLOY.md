# Deploying the app: dev first, then live

Gavan, 2026-10-14: "how do we ensure the deployment cycle goes to hunt-dev
then the hunt?"

| Where | What it serves | How it moves |
|---|---|---|
| https://try-groundwind-hunt-dev.gavan-acton.workers.dev | a working tree, uncommitted changes and all (badge **TRY**) | `app/scripts/deploy-dev.ps1` by hand |
| https://hunt-dev.groundwind.app | `main` (badge **DEV · sha**) | every push to `main` (`.github/workflows/dev.yml`) |
| https://hunt.groundwind.app | the `live` branch | `git push origin <sha>:live` (`.github/workflows/pages.yml`) |

## The cycle

1. **Commit and push to `main` as usual.** Every session does. A push
   builds the dev site in a few minutes. It never touches the live app.
2. **Check it on the dev site**, on the phone. The badge at the foot of
   the screen names the commit (DEV · 4f2b48d).
3. **Promote that commit:**

       git fetch origin
       git push origin 4f2b48d:live

   - Use the badge's sha, not "main now": another session may have pushed
     since you checked.
   - The push has to be a fast-forward, so `live` only moves on. A
     rejected push means `live` has something `main` lacks; look before
     forcing.
   - Promoting is Gavan's call. A session pushes `main`, never `live`,
     unless he says so.
4. **Roll back** by putting `live` on the previous good commit:
   `git push --force origin <old sha>:live`.

`pages.yml` runs only on `live`; run by hand on any other branch, it does
nothing. The repo's `github-pages` environment lets only `live` deploy.

## Trying a working tree

`powershell -ExecutionPolicy Bypass -File app/scripts/deploy-dev.ps1 [-SkipSync]`

- It uploads a preview version of the dev Worker under the alias `try`. The
  dev site's own version, main's, stays as it is.
- The badge reads TRY: the sha is the tree's base, with changes on top, so
  never promote by it.
- It runs with wrangler's own login. The `CLOUDFLARE_API_TOKEN` in XEVO's
  environment can't see the dev Worker, so the script clears it for the
  upload.
- From PowerShell only: Git Bash turns `BASE_PATH=/` into a Windows path.

## Data

- **The dev builds** (main's and the tries) read their data from R2,
  `https://data.groundwind.app/data/`.
  - `dev.yml` syncs `app/public/data` from the commit before deploying,
    with the manifests last.
  - A try's sync sends its tree's data too, uncommitted bakes included
    (`-SkipSync` leaves R2 alone).
  - So R2 holds the newest data synced from anywhere, not one commit's.
- **The live app reads the same R2 prefix** since 2026-10-17 (Gavan: "live
  needs to be everything on hunt dev"): `pages.yml` sets `VITE_DATA_BASE`
  to `https://data.groundwind.app/data/`, so every area, the far band and
  the tiles that hunt-dev has, live has. The live bundle itself is the app
  alone (a few MB) once `KEEP_DATA_IN_DIST` is dropped from `pages.yml`:
  it was kept for the first deploy after the switch, so a phone still on
  the build before it finds its own `data/` until it updates. Drop it on
  the next promote.
  - What that means: a dev push that re-bakes an area changes what hunters
    see before the app that goes with it is promoted. The data formats
    change rarely; when one does (a `.hab` layout, an archive's keys),
    promote the app in the same breath.
  - Live's manifests are the ones `dev.yml` wrote from main's last build.
    The live workflow does not sync, so the two never race for the prefix.

## Secrets (repo Settings → Secrets and variables → Actions)

| Secret | For |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `dev.yml`'s deploy: a token with Account → Workers Scripts: Edit (the account id is in `app/dev-site/wrangler.toml`) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `dev.yml`'s data sync: the same R2 keys as in XEVO's user environment |
| `CF_CACHE_TOKEN` | `pages.yml`'s cache purge (optional, unchanged) |

Without the first three, `dev.yml` fails at the step that needs them, and
nothing else is affected.

## Not covered

The groundwind.app site and its Worker (`site/`) still deploy by hand with
`npx wrangler deploy` from `site/`. A dev copy of it would follow the same
pattern.
