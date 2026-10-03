import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * data/manifest.json: every baked data file's size and a hash of its
 * bytes, so a phone holding the maps offline can tell when one has been
 * rebaked (offline/updates.ts). GitHub Pages stamps every file with the
 * deploy's date, so dates and ETags cannot say which files changed.
 */
function dataManifest(): Plugin {
  const dir = fileURLToPath(new URL('./public/data/', import.meta.url))
  const seen = new Map<string, { key: string; hash: string }>()
  const build = () => {
    const files: Record<string, { size: number; hash: string }> = {}
    for (const name of readdirSync(dir)) {
      if (name === 'manifest.json') continue
      const st = statSync(dir + name)
      if (!st.isFile()) continue
      const key = `${st.size}:${st.mtimeMs}`
      let hit = seen.get(name)
      if (hit?.key !== key) {
        hit = { key, hash: createHash('sha1').update(readFileSync(dir + name)).digest('hex').slice(0, 16) }
        seen.set(name, hit)
      }
      files[name] = { size: st.size, hash: hit.hash }
    }
    return JSON.stringify({ files })
  }
  return {
    name: 'data-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/data/manifest.json')) return next()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(build())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'data/manifest.json', source: build() })
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['data/**', 'fonts/**', 'sprites/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/fonts\/.+\.pbf$/, handler: 'CacheFirst', options: { cacheName: 'glyphs', expiration: { maxEntries: 600 } } },
          { urlPattern: /\/sprites\//, handler: 'CacheFirst', options: { cacheName: 'sprites', expiration: { maxEntries: 40 } } },
          // live map services: cache what has been looked at, for the drive out
          {
            urlPattern: /^https:\/\/(maps\.geogratis\.gc\.ca|datacube\.services\.geo\.ca|ws\.lioservices\.lrc\.gov\.on\.ca|ws\.gisdynamic\.lrc\.gov\.on\.ca|server\.arcgisonline\.com|tiles\.arcgis\.com)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'live-tiles', expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 120 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
