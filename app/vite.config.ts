import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { badAreaField } from './src/areas/check.ts'

/** What the plugin reads of an area file (src/areas/<id>.json). */
interface AreaFile {
  id: string
  name: string
  centre: [number, number]
  region: { west: number; south: number; east: number; north: number }
  base: string
  files: { pmtiles: string[]; geo: string[]; baseGeo: string[]; grids: string[] }
}

type Listing = Record<string, { size: number; hash: string }>

const sha16 = (data: string | Buffer) => createHash('sha1').update(data).digest('hex').slice(0, 16)

/** A file of the area's pack, the files the app saves for it (config.ts
 *  BUNDLES), told from the pipeline's intermediates by its layer. A PMTiles
 *  key and its file's stem differ only by case and hyphens (contoursWide,
 *  contours-wide; bathySheets, bathysheets). */
function inPack(name: string, a: AreaFile): boolean {
  const suffix = `-${a.id}.`
  const at = name.lastIndexOf(suffix)
  if (at <= 0) return false
  const stem = name.slice(0, at)
  const ext = name.slice(at + suffix.length)
  const flat = (s: string) => s.replace(/-/g, '').toLowerCase()
  if (ext === 'pmtiles') return a.files.pmtiles.some((k) => flat(k) === flat(stem))
  if (ext === 'geojson') return a.files.geo.includes(stem) || a.files.baseGeo.includes(stem)
  if (ext === 'hab') return a.files.grids.includes(stem)
  return false
}

/**
 * The data manifests: every baked file's size and a hash of its bytes, so
 * a phone holding an area's maps offline can tell when one has been
 * rebaked (offline/updates.ts). GitHub Pages stamps every file with the
 * deploy's date, so dates and ETags cannot say which files changed.
 *
 * - data/manifest.json: Pickle Lake's flat files, exactly as before there
 *   were areas (installed builds read it).
 * - data/areas/<id>/manifest.json: each other area's folder, subfolders
 *   too, less files still being written (empty, .part).
 * - data/areas/index.json: the areas, from their files in src/areas, each
 *   with its manifest's address and hash and its pack's files and bytes,
 *   so a phone can size an area it has never saved.
 */
function dataManifest(): Plugin {
  const dir = fileURLToPath(new URL('./public/data/', import.meta.url))
  const areaDir = fileURLToPath(new URL('./src/areas/', import.meta.url))
  const seen = new Map<string, { key: string; hash: string }>()
  /** a file's hash, kept while its size and time stay the same */
  const hashOf = (rel: string, size: number, mtimeMs: number) => {
    const key = `${size}:${mtimeMs}`
    let hit = seen.get(rel)
    if (hit?.key !== key) {
      hit = { key, hash: sha16(readFileSync(dir + rel)) }
      seen.set(rel, hit)
    }
    return hit.hash
  }
  const build = () => {
    const files: Listing = {}
    for (const name of readdirSync(dir)) {
      if (name === 'manifest.json') continue
      const st = statSync(dir + name)
      if (!st.isFile()) continue
      files[name] = { size: st.size, hash: hashOf(name, st.size, st.mtimeMs) }
    }
    return JSON.stringify({ files })
  }
  /** An area folder's files by their path under it. */
  const listFolder = (base: string): Listing => {
    const files: Listing = {}
    const walk = (sub: string) => {
      let names: string[] = []
      try {
        names = readdirSync(dir + base + sub)
      } catch {
        return // not baked yet: an empty manifest
      }
      for (const name of names) {
        const rel = sub + name
        if (rel === 'manifest.json') continue
        const st = statSync(dir + base + rel)
        if (st.isDirectory()) walk(`${rel}/`)
        else if (st.isFile() && st.size > 0 && !/\.(part|tmp)$/.test(name)) files[rel] = { size: st.size, hash: hashOf(base + rel, st.size, st.mtimeMs) }
      }
    }
    walk('')
    return files
  }
  // read afresh each time: the bake rewrites an area's file as it goes, and
  // one caught half written is left out of this answer, not the server's end
  const areas = (): AreaFile[] => {
    const out: AreaFile[] = []
    for (const name of readdirSync(areaDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const a = JSON.parse(readFileSync(areaDir + name, 'utf8')) as AreaFile
        if (typeof a.id === 'string' && typeof a.base === 'string' && a.files) out.push(a)
      } catch {
        /* mid-write */
      }
    }
    return out
  }
  const manifestOf = (a: AreaFile) => (a.base ? JSON.stringify({ files: listFolder(a.base) }) : build())
  const index = (list: AreaFile[]) =>
    JSON.stringify({
      areas: list.map((a) => {
        const body = manifestOf(a)
        const files = (JSON.parse(body) as { files: Listing }).files
        const pack = Object.keys(files).filter((n) => inPack(n, a))
        return {
          id: a.id,
          name: a.name,
          region: a.region,
          centre: a.centre,
          base: a.base,
          manifest: `${a.base}manifest.json`,
          hash: sha16(body),
          bytes: pack.reduce((sum, n) => sum + files[n].size, 0),
          files: pack,
        }
      }),
    })
  const json = (res: ServerResponse, body: string) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
  return {
    name: 'data-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path.endsWith('/data/manifest.json')) return json(res, build())
        if (path.endsWith('/data/areas/index.json')) return json(res, index(areas()))
        const m = /\/data\/areas\/([a-z0-9-]+)\/manifest\.json$/.exec(path)
        const a = m ? areas().find((x) => x.id === m[1] && x.base) : undefined
        if (a) return json(res, manifestOf(a))
        next()
      })
    },
    generateBundle() {
      // an area file the app would leave out stops the build: shipped as a
      // phone's saved area (Pickle Lake's above all), it would open on another
      // area, or on none (areas/check.ts)
      for (const name of readdirSync(areaDir)) {
        if (!name.endsWith('.json')) continue
        let bad: string | null
        try {
          bad = badAreaField(JSON.parse(readFileSync(areaDir + name, 'utf8')))
        } catch (e) {
          bad = `the whole file (${(e as Error).message})`
        }
        if (bad) this.error(`src/areas/${name}: ${bad} is missing or not what the app reads`)
      }
      this.emitFile({ type: 'asset', fileName: 'data/manifest.json', source: build() })
      const list = areas()
      this.emitFile({ type: 'asset', fileName: 'data/areas/index.json', source: index(list) })
      for (const a of list) if (a.base) this.emitFile({ type: 'asset', fileName: `data/${a.base}manifest.json`, source: manifestOf(a) })
    },
  }
}

// BASE_PATH lets the same build target a GitHub Pages project site (e.g. /huntapp/)
/** The short git sha and the build time, stamped into the bundle for the
 *  dev log and its snapshot: a log that names its commit is one you can
 *  read against the code. */
function buildStamp(): { sha: string; at: string } {
  const sha =
    process.env.GITHUB_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      } catch {
        return 'local'
      }
    })()
  return { sha: sha.slice(0, 7), at: new Date().toISOString() }
}

/** version.json beside the bundle: the build's sha and time, which the app
 *  on a phone fetches past every cache to see whether it is behind
 *  (offline/appUpdate.ts). Not precached, so it always says the server's. */
function versionFile(stamp: { sha: string; at: string }): Plugin {
  const body = JSON.stringify(stamp)
  return {
    name: 'version-file',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/version.json') return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(body)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body })
    },
  }
}

const STAMP = buildStamp()

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: { __BUILD__: JSON.stringify(STAMP) },
  build: { target: ['es2022', 'safari16'] },
  // docs/HUNTOS.md sits beside app/, bundled into Settings as the guide
  server: { host: true, allowedHosts: true, fs: { allow: ['..'] } },
  preview: { host: true, allowedHosts: true },
  plugins: [
    ...(process.env.HTTPS_DEV ? [basicSsl()] : []),
    react(),
    dataManifest(),
    versionFile(STAMP),
    VitePWA({
      registerType: 'autoUpdate',
      // the app registers the worker itself (offline/appUpdate.ts) so it can ask for updates
      injectRegister: false,
      manifest: {
        name: 'Pic River — hunt & fish maps',
        short_name: 'Pic River',
        description: 'Offline topo, LiDAR, forest cover, lake depths, historical maps and weather for White Lake and the Pic River country',
        theme_color: '#0f1a12',
        background_color: '#0f1a12',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // a new worker takes over as soon as it is in, not when every window
        // of the app has closed (an installed app on a phone rarely is). The
        // plugin sets these itself only when it registers the worker, and
        // injectRegister is off: without them a new build sat waiting
        // (2026-10-03, "fetching it…" and nothing)
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['data/**', 'fonts/**', 'sprites/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/fonts\/.+\.pbf$/, handler: 'CacheFirst', options: { cacheName: 'glyphs', expiration: { maxEntries: 600 } } },
          { urlPattern: /\/sprites\//, handler: 'CacheFirst', options: { cacheName: 'sprites', expiration: { maxEntries: 40 } } },
          // live map services: cache what has been looked at, for the drive out
          // (Quebec's imagery too, for an area there)
          {
            urlPattern: /^https:\/\/(maps\.geogratis\.gc\.ca|datacube\.services\.geo\.ca|ws\.lioservices\.lrc\.gov\.on\.ca|ws\.gisdynamic\.lrc\.gov\.on\.ca|server\.arcgisonline\.com|tiles\.arcgis\.com|servicesmatriciels\.mern\.gouv\.qc\.ca)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'live-tiles', expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 120 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
