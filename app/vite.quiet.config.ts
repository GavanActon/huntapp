// The dev server for headless runs (scripts/replay.py, screenshots): the
// app's own config with hot reload and file watching off, so another
// session's edits never reload the page a script is driving, and a module
// imported from page.evaluate is the app's own instance (no ?t= copies).
//   node node_modules/vite/bin/vite.js --config vite.quiet.config.ts --port 5195 --strictPort
import { mergeConfig } from 'vite'
import base from './vite.config.ts'

export default mergeConfig(base, { server: { hmr: false, watch: null } })
