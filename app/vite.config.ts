import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'
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

/** An archive's zoom range and bounds, from its PMTiles v3 header: the map
 *  names a streamed archive's tiles with them instead of reading the header
 *  the moment the source is added (map/mapStyle.ts archive) */
type ArchiveRange = { z: [number, number]; bounds: [number, number, number, number] }
type Listing = Record<string, { size: number; hash: string } & Partial<ArchiveRange>>

function archiveRange(path: string): Partial<ArchiveRange> {
  if (!path.endsWith('.pmtiles')) return {}
  const fd = openSync(path, 'r')
  try {
    const b = Buffer.alloc(127)
    if (readSync(fd, b, 0, 127, 0) < 127 || b.toString('ascii', 0, 7) !== 'PMTiles' || b[7] !== 3) return {}
    const deg = (at: number) => b.readInt32LE(at) / 1e7
    return { z: [b[100], b[101]], bounds: [deg(102), deg(106), deg(110), deg(114)] }
  } finally {
    closeSync(fd)
  }
}

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
      files[name] = { size: st.size, hash: hashOf(name, st.size, st.mtimeMs), ...archiveRange(dir + name) }
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
        else if (st.isFile() && st.size > 0 && !/\.(part|tmp)$/.test(name)) files[rel] = { size: st.size, hash: hashOf(base + rel, st.size, st.mtimeMs), ...archiveRange(dir + base + rel) }
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

/** The app's web manifest: Pickle Lake's, as it has always been. VitePWA
 *  writes it (manifest.webmanifest, with lang and scope filled in), and
 *  each other area's iPhone manifest is made from it (areaLinks). */
const MANIFEST = {
  name: 'Groundwind',
  short_name: 'Groundwind',
  description: "Head-height wind and scent for hunting, from Environment Canada's HD forecast over LiDAR terrain. Works offline.",
  theme_color: '#0a100b',
  background_color: '#0a100b',
  display: 'standalone',
  orientation: 'any',
  start_url: '.',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    // the mark inside the central 80% circle, for a launcher that crops to its own shape
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} satisfies Partial<ManifestOptions>

/** The area the plain address opens (areas/index.ts DEFAULT_AREA), whose manifest is the app's own. */
const DEFAULT_AREA = 'pickle-lake'

/** What index.html's head script has in place of the areas it knows. */
const AREAS_SLOT = '/*AREAS*/{}'

/** Another area's iPhone manifest: the app's, named for the area, starting
 *  on it while the install has nothing saved (?start=, areas/start.ts). No
 *  id: its own start_url is who it is, so it is never taken for the app
 *  (Chrome would offer to rename an install to it). */
function areaManifest(a: { id: string; name: string }, scope: string): string {
  return JSON.stringify({
    name: `${a.name} · Groundwind`,
    short_name: a.name,
    description: `Offline topo, LiDAR, forest cover and weather for ${a.name}`,
    start_url: `./?start=${a.id}`,
    display: MANIFEST.display,
    background_color: MANIFEST.background_color,
    theme_color: MANIFEST.theme_color,
    lang: 'en',
    scope,
    orientation: MANIFEST.orientation,
    icons: MANIFEST.icons,
  })
}

/**
 * An iPhone install of another area (docs/AREAS.md, Links and sharing). A
 * link never reaches a home-screen app: it opens Safari, and the icon added
 * from there starts at its manifest's start_url, with storage of its own.
 * Add to Home Screen keeps the first manifest link in the head, so a page
 * on another area has to put that area's ahead of the app's (index.html's
 * head script does, from what this puts in its slot: every area's name and
 * region, and each one's manifest but Pickle Lake's). The manifests are
 * written for each area but Pickle Lake, and served in dev too.
 */
function areaLinks(): Plugin {
  const areaDir = fileURLToPath(new URL('./src/areas/', import.meta.url))
  const dataDir = fileURLToPath(new URL('./public/data/', import.meta.url))
  let base = '/'
  /** How many bytes of a grid the first view reads, for the page's early
   *  fetch of it: a v2 file's header and the bands before its "first"
   *  boundary (pipeline/habfile.py), else the whole file. Null when it is
   *  not baked. */
  const firstBytes = (path: string): number | null => {
    try {
      const fd = openSync(path, 'r')
      try {
        const head = Buffer.alloc(8)
        readSync(fd, head, 0, 8, 0)
        if (head.toString('latin1', 0, 4) !== 'HAB2') return statSync(path).size
        const n = head.readUInt32LE(4)
        const hj = Buffer.alloc(n)
        readSync(fd, hj, 0, n, 8)
        const h = JSON.parse(hj.toString('utf8')) as { first?: number; previewEnd?: number }
        // a micro grid's preview bands come first, and are all the page asks for; the app reads the rest
        return 8 + n + (h.previewEnd ?? h.first ?? 0)
      } finally {
        closeSync(fd)
      }
    } catch {
      return null
    }
  }
  interface AreaSlot {
    id: string
    name: string
    region: AreaFile['region']
    base: string
    /** the grids the first view reads (the wind grid first, HD then SD), and how much of each */
    grids: { file: string; first: number }[]
  }
  // the area files the app would load (a bad one stops the build: dataManifest)
  const areas = () => {
    const out: AreaSlot[] = []
    for (const name of readdirSync(areaDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const a = JSON.parse(readFileSync(areaDir + name, 'utf8')) as AreaFile
        if (badAreaField(a) != null) continue
        // the region's four numbers alone (areas/check.ts has them all numbers)
        const { west, south, east, north } = a.region
        const grids: AreaSlot['grids'] = []
        for (const g of ['micro', 'micro-sd', 'habitat']) {
          if (!a.files.grids.includes(g)) continue
          const file = `${g}-${a.id}.hab`
          const first = firstBytes(dataDir + a.base + file)
          if (first) grids.push({ file, first })
        }
        out.push({ id: a.id, name: a.name, region: { west, south, east, north }, base: a.base, grids })
      } catch {
        /* mid-write */
      }
    }
    return out
  }
  const fileOf = (id: string) => `manifest-${id}.webmanifest`
  const others = () => areas().filter((a) => a.id !== DEFAULT_AREA)
  // every area the app knows (a link naming one the build lacks is not taken), its region
  // (a link's spot picks the area it is in first, as areas/start.ts does), its folder and
  // the grids the page fetches early, and each one's manifest but Pickle Lake's, with <
  // written as its escape: it goes inside a <script>
  const slot = () =>
    JSON.stringify({
      default: DEFAULT_AREA,
      data: `${base}data/`,
      areas: Object.fromEntries(
        areas().map((a) => [a.id, { name: a.name, region: a.region, base: a.base, grids: a.grids, ...(a.id === DEFAULT_AREA ? {} : { manifest: base + fileOf(a.id) }) }]),
      ),
    }).replace(/</g, '\\u003c')
  return {
    name: 'area-links',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const a = others().find((x) => path === base + fileOf(x.id))
        if (!a) return next()
        res.setHeader('content-type', 'application/manifest+json')
        res.end(areaManifest(a, base))
      })
    },
    transformIndexHtml(html) {
      if (!html.includes(AREAS_SLOT)) throw new Error(`index.html: the head script has lost its ${AREAS_SLOT}`)
      return html.replace(AREAS_SLOT, slot())
    },
    generateBundle() {
      for (const a of others()) this.emitFile({ type: 'asset', fileName: fileOf(a.id), source: areaManifest(a, base) })
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
    areaLinks(),
    VitePWA({
      registerType: 'autoUpdate',
      // the app registers the worker itself (offline/appUpdate.ts) so it can ask for updates
      injectRegister: false,
      // the manifest's icons are not precached either (globIgnores below has the rest of icons/)
      includeManifestIcons: false,
      manifest: MANIFEST,
      workbox: {
        // a new worker takes over as soon as it is in, not when every window
        // of the app has closed (an installed app on a phone rarely is). The
        // plugin sets these itself only when it registers the worker, and
        // injectRegister is off: without them a new build sat waiting
        // (2026-10-03, "fetching it…" and nothing)
        skipWaiting: true,
        clientsClaim: true,
        // the areas' iPhone manifests too: an icon added with no signal still gets its area
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'manifest-*.webmanifest'],
        // the icons too (580 KB): the home screen reads them when the app is added, online
        globIgnores: ['data/**', 'fonts/**', 'sprites/**', 'icons/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/fonts\/.+\.pbf$/, handler: 'CacheFirst', options: { cacheName: 'glyphs', expiration: { maxEntries: 600 } } },
          { urlPattern: /\/sprites\//, handler: 'CacheFirst', options: { cacheName: 'sprites', expiration: { maxEntries: 40 } } },
          // A cold start waits on every entry in the cache store: Safari opens it
          // whole before the worker can hand the app its own files, and 18,000
          // tiles kept one by one made an iPhone wait 10 to 16 s (2026-10-10). So
          // the caches below are kept small, trim themselves when the phone is
          // full (purgeOnQuotaError), and keep only real answers (200: an opaque
          // one counts as megabytes against the quota). What is kept for the
          // field in bulk is kept as packs, one file each (offline/tilePack.ts).
          //
          // the sharp imagery over an area's baked one (sources.ts SHARP), as looked
          // at where the area's pack lacks it (map/pmtilesRegistry.ts sharp://). A
          // save fetches into the pack, marked gwpack, and the worker leaves those
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/[^?]*$/,
            handler: 'CacheFirst',
            options: { cacheName: 'imagery-tiles', expiration: { maxEntries: 1500, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
          },
          // live map services: cache what has been looked at, for the drive out
          // (Quebec's imagery too, for an area there); an area's own layers are its
          // saved archives, so a thousand is the drive's worth
          {
            // the live base map (NRCan CBMT) among them: it came off the network on every pan, downloaded area or not (2026-10-07)
            urlPattern: /^(?!.*[?&]gwpack=)https:\/\/(maps-cartes\.services\.geo\.ca|maps\.geogratis\.gc\.ca|datacube\.services\.geo\.ca|ws\.lioservices\.lrc\.gov\.on\.ca|ws\.gisdynamic\.lrc\.gov\.on\.ca|server\.arcgisonline\.com|tiles\.arcgis\.com|servicesmatriciels\.mern\.gouv\.qc\.ca)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'live-tiles',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 120, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
})
