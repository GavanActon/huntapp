import { useAppStore } from '../state/appStore'

/**
 * The light, the strip's light button's three stops (Gavan, 2026-10-19:
 * "light button actually is three options - (night, day, and red mode -
 * which shifts everything into the red spectrum)"; named Dark, Bright and
 * Red light 10-21): Dark, the dark forest set of tokens; Bright, Outdoor's
 * for sun on the phone; Red light, the dark set
 * with everything, the map too, turned to red alone (theme.css). One
 * attribute each on the root.
 */
function apply() {
  const root = document.documentElement
  const { outdoor, redLight } = useAppStore.getState()
  const red = redLight && !outdoor
  if (outdoor) root.dataset.theme = 'outdoor'
  else delete root.dataset.theme
  if (red) root.dataset.red = ''
  else delete root.dataset.red
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  // the phone's own bar goes black under red: its green would be the one colour left on the screen
  if (meta) meta.content = red ? '#000000' : getComputedStyle(root).getPropertyValue('--c-bg').trim() || meta.content
}

let inited = false

export function initTheme() {
  if (inited) return
  inited = true
  apply()
  useAppStore.subscribe((s, prev) => {
    if (s.outdoor !== prev.outdoor || s.redLight !== prev.redLight) apply()
  })
}
