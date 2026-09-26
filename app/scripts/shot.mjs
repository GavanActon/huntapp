// Screenshot the dev app: node scripts/shot.mjs <url> <out.png> [w] [h] ["click:sel;wait:ms"]
// Run from BoatApp/app (puppeteer-core lives there) or install it here.
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5176/'
const out = process.argv[3] ?? 'app.png'
const width = Number(process.argv[4] ?? 430)
const height = Number(process.argv[5] ?? 800)
const actions = process.argv[6] ?? ''

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=2'],
  defaultViewport: { width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await new Promise((r) => setTimeout(r, 9000))
for (const act of actions.split(';').filter(Boolean)) {
  const [verb, ...rest] = act.split(':')
  const arg = rest.join(':')
  if (verb === 'click') await page.click(arg).catch((e) => logs.push(`[actfail] ${arg}: ${e.message}`))
  if (verb === 'wait') await new Promise((r) => setTimeout(r, Number(arg)))
  await new Promise((r) => setTimeout(r, 2000))
}
await page.screenshot({ path: out })
console.log(logs.filter((l) => !/favicon|manifest/.test(l)).slice(-25).join('\n'))
console.log('SCREENSHOT_OK', out)
await browser.close()
