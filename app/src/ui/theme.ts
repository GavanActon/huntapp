import { useAppStore } from '../state/appStore'

/**
 * The chrome's theme: the dark forest set of tokens, or Outdoor (Settings)
 * for sun on the phone. One attribute on the root; theme.css holds both.
 */
function apply() {
  const root = document.documentElement
  if (useAppStore.getState().outdoor) root.dataset.theme = 'outdoor'
  else delete root.dataset.theme
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--c-bg').trim() || meta.content
}

let inited = false

export function initTheme() {
  if (inited) return
  inited = true
  apply()
  useAppStore.subscribe((s, prev) => {
    if (s.outdoor !== prev.outdoor) apply()
  })
}
