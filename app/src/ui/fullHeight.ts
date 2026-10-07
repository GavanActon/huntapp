import { devlog } from '../devlog'

/**
 * The page as tall as the screen in the installed app on an iPhone. With
 * the status bar see-through (black-translucent), iOS draws the page from
 * the top of the screen, under the status bar, yet gives it a viewport the
 * status bar's height short: on Gavan's phone a screen 852 px tall and a
 * viewport of 793. A page 100% tall stopped 59 px above the bottom, and the
 * background showed under the map as a black band (2026-10-07).
 *
 * Only that case is corrected: launched from the home screen on iOS
 * (navigator.standalone, which no other browser has), as wide as the
 * screen, and short by the status bar's height (safe-area-inset-top). An
 * iOS that gets the viewport right leaves the page at 100%.
 */

let probe: HTMLDivElement | null = null

/** The status bar's height, px: env(safe-area-inset-top) measured on a probe. */
function topInset(): number {
  if (!probe) {
    probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top,0px)'
    document.body.appendChild(probe)
  }
  return probe.offsetHeight
}

let logged = ''

function fit() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  // iOS keeps screen.width and height as the portrait figures
  const portrait = innerHeight >= innerWidth
  const sw = portrait ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)
  const sh = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)
  const short = sh - innerHeight
  const inset = standalone ? topInset() : 0
  const fix = standalone && innerWidth === sw && inset > 0 && short > 0 && Math.abs(short - inset) <= 2
  const h = fix ? `${sh}px` : ''
  for (const el of [document.documentElement, document.body, document.getElementById('root')]) if (el && el.style.height !== h) el.style.height = h
  const note = fix ? `${innerWidth}x${innerHeight} · page ${sh} tall, the status bar's ${inset} px put back` : ''
  if (note && note !== logged) devlog('vp', note)
  logged = note
}

/** Call once at startup, before the first render: fits now and on every resize, turn and return. */
export function initFullHeight() {
  fit()
  addEventListener('resize', fit)
  addEventListener('orientationchange', () => setTimeout(fit, 300))
  addEventListener('pageshow', fit)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fit()
  })
}
