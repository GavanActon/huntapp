// Loops play only while on screen, each with its own pause. With reduced
// motion, or where the phone refuses to autoplay (an iPhone in Low Power
// Mode), a loop waits behind a big play button: a tap on the phone plays it,
// and after a refusal the first tap anywhere starts the loops on screen.
;(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const vids = [...document.querySelectorAll('video[data-loop]')]
  const held = new WeakSet() // paused by the reader, or by reduced motion
  const seen = new Set() // on screen now
  const label = (v) => v.parentElement.querySelector('.loop-toggle')?.setAttribute('aria-label', v.paused ? 'Play' : 'Pause')
  const wait = (v, on) => v.parentElement.classList.toggle('wait', on)

  let armed = false
  const play = (v) => {
    if (v.preload === 'none') v.preload = 'auto'
    v.play().then(
      () => wait(v, false),
      () => {
        wait(v, true)
        label(v)
        armTap()
      },
    )
  }
  // a tap is the phone's permission to play: start what's on screen
  const armTap = () => {
    if (armed) return
    armed = true
    document.addEventListener(
      'click',
      () => {
        armed = false
        for (const v of seen) if (v.paused && !held.has(v)) play(v)
      },
      { once: true, capture: true },
    )
  }

  for (const v of vids) {
    v.muted = true
    if (still) {
      held.add(v)
      wait(v, true)
    }
    v.addEventListener('play', () => label(v))
    v.addEventListener('pause', () => label(v))
    label(v)
    // the whole phone is the button; the corner one is there for keyboards
    v.parentElement.addEventListener('click', () => {
      if (v.paused || v.parentElement.classList.contains('wait')) {
        held.delete(v)
        play(v)
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
        if (e.isIntersecting) {
          seen.add(v)
          if (!held.has(v)) play(v)
        } else {
          seen.delete(v)
          v.pause()
        }
      }
    },
    { threshold: 0.35 },
  )
  vids.forEach((v) => io.observe(v))
})()
