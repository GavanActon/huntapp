import { useAppStore } from '../state/appStore'
import { useCheckForm } from '../ui/GroundCard'
import { ensureProfile, onProfile } from '../weather/boundaryLayer'
import { groundWind, loadMicro, onMicro } from '../weather/micro/model'
import { useWindChecks } from '../weather/micro/windChecks'
import { ensureWeatherGrid } from '../weather/windGrid'

/**
 * The ground air in a tapped point's "more": the air at head height
 * there, one headline and a tag (decoupled, swirly, gusty), its reasons, and
 * logging what the wind is actually doing. The scent cone is the
 * popup's own button, up front.
 */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function arrow(toward: number): string {
  return `<svg width="12" height="12" viewBox="0 0 14 14" style="transform:rotate(${Math.round(toward) % 360}deg)"><path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor"/></svg>`
}

export function attachTapGround(el: HTMLElement, lon: number, lat: number, closePopup: () => void): () => void {
  let alive = true
  const render = () => {
    if (!alive) return
    const ms = useAppStore.getState().planTimeMs ?? Date.now()
    const g = groundWind(lon, lat, ms)
    if (!g) {
      el.innerHTML = ''
      return
    }
    const imperial = useAppStore.getState().units === 'imperial'
    const spd = imperial ? `${(g.kmh * 0.621371).toFixed(1)} mph` : `${g.kmh.toFixed(1)} km/h`
    const tags = [g.decoupled ? 'decoupled' : '', g.swirl ? 'swirly' : '', g.gusty ? 'gusty' : '', g.sigmaDeg >= 60 ? `±${Math.round(g.sigmaDeg)}°` : ''].filter(Boolean)
    el.innerHTML =
      `<div class="pg-head">${arrow((g.dirFrom + 180) % 360)}<span>Ground: ${esc(g.headline)}</span>${tags.map((t) => `<em class="pg-tag">${esc(t)}</em>`).join('')}</div>` +
      `<ul>${g.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}<li>Head height ${esc(spd)} · forecast ${Math.round(g.regionalKmh)} km/h at 10 m${g.inGrid ? '' : ' · outside the ground model'}</li></ul>` +
      `<div class="pg-acts"><button class="linklike pg-check" type="button">sharpen the wind here</button></div>`
    el.querySelector('.pg-check')?.addEventListener('click', () => {
      useCheckForm.getState().open(lon, lat, 'tapped spot')
      closePopup()
    })
  }
  render()
  void Promise.all([loadMicro(), ensureProfile(), ensureWeatherGrid()]).then(render)
  const offs = [
    onMicro(render),
    onProfile(render),
    useWindChecks.subscribe(render),
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs || s.units !== p.units) render()
    }),
  ]
  return () => {
    alive = false
    for (const off of offs) off()
  }
}
