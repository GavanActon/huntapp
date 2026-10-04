// Loops play only while on screen, each with its own pause; with reduced
// motion they hold their poster until someone presses play.
;(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const label = (v) => v.parentElement.querySelector('.loop-toggle')?.setAttribute('aria-label', v.paused ? 'Play' : 'Pause')
  const held = new WeakSet()
  const vids = [...document.querySelectorAll('video[data-loop]')]
  for (const v of vids) {
    v.muted = true
    if (still) held.add(v)
    v.addEventListener('play', () => label(v))
    v.addEventListener('pause', () => label(v))
    label(v)
    v.parentElement.querySelector('.loop-toggle')?.addEventListener('click', () => {
      if (v.paused) {
        held.delete(v)
        v.play().catch(() => {})
      } else {
        held.add(v)
        v.pause()
      }
    })
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target
        if (e.isIntersecting && !held.has(v)) {
          if (v.preload === 'none') v.preload = 'auto'
          v.play().catch(() => label(v))
        } else if (!e.isIntersecting) v.pause()
      }
    },
    { threshold: 0.35 },
  )
  vids.forEach((v) => io.observe(v))
})()
