import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets the same build target a GitHub Pages project site (e.g. /huntapp/)
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: ['es2022', 'safari16'] },
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
  plugins: [
    ...(process.env.HTTPS_DEV ? [basicSsl()] : []),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
