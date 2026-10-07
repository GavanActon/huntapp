import maplibregl from 'maplibre-gl'
import type { Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../map/mapController'
import { closeOnTapOff } from '../map/tapPopup'
import { agoLabel } from '../time'
import { memberColour } from './partyCode'
import { SCENT_FRESH_MS, showMemberScent, usePartyStore, type Member } from './party'
import '../ui/party.css'

/**
 * The party on the map (party.ts): each member with a position, a dot in
 * their colour with their initials, and how long ago it was placed under
 * it. A position fades as it ages and goes hollow past two hours, when it
 * stops counting for their scent: a dot is where a phone last said, never
 * where someone is for sure. Tap a dot for when, how high they sit, and
 * their scent.
 *
 * Markers, not a style layer, like the scent card's people: they stay over
 * everything drawn on the map, the scent's cloud included, and a party is
 * a handful of people.
 */

/** How old a position is, short: "now", "12 min", "3 h" (never "12m", which reads as metres beside a stand's height). */
function ageShort(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 2) return 'now'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`
}

let popup: maplibregl.Popup | null = null

function showMemberPopup(map: MlMap, m: Member) {
  if (!m.pos) return
  popup?.remove()
  const age = Date.now() - m.pos.ts
  const el = document.createElement('div')
  el.className = 'depth-popup-ground pt-pop'
  const head = document.createElement('div')
  head.className = 'pg-head'
  head.textContent = m.who
  const line = document.createElement('div')
  line.className = 'dim'
  line.textContent = [`placed ${agoLabel(age)}`, m.pos.h > 2 ? `in a stand, ${m.pos.h} m` : 'on the ground', m.pos.mv ? 'walking' : null, m.pos.acc && m.pos.acc > 25 ? `±${m.pos.acc} m` : null].filter(Boolean).join(' · ')
  el.append(head, line)
  const p = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 18, maxWidth: '240px' }).setLngLat([m.pos.lon, m.pos.lat]).setDOMContent(el).addTo(map)
  if (age <= SCENT_FRESH_MS) {
    const b = document.createElement('button')
    b.className = 'linklike'
    b.type = 'button'
    b.textContent = 'Their scent'
    b.addEventListener('click', () => {
      p.remove()
      showMemberScent(m.mid)
    })
    el.append(b)
  } else {
    const old = document.createElement('div')
    old.className = 'dim'
    old.textContent = 'Too long ago to show their scent'
    el.append(old)
  }
  closeOnTapOff(map, p)
  p.on('close', () => {
    if (popup === p) popup = null
  })
  popup = p
}

const markers = new Map<string, maplibregl.Marker>()
let markersOn: MlMap | null = null

function sync(map: MlMap | null) {
  if (markersOn !== map) {
    for (const mk of markers.values()) mk.remove()
    markers.clear()
    markersOn = map
  }
  if (!map) return
  const now = Date.now()
  const { party, members } = usePartyStore.getState()
  const here = new Set<string>()
  if (party) {
    for (const m of Object.values(members)) {
      if (!m.pos) continue
      here.add(m.mid)
      let mk = markers.get(m.mid)
      if (!mk) {
        const el = document.createElement('div')
        el.className = 'pt-mk'
        el.innerHTML = '<b></b><small></small>'
        const mid = m.mid
        el.addEventListener('click', (e) => {
          // the map's own tap popup stays shut
          e.stopPropagation()
          const latest = usePartyStore.getState().members[mid]
          if (latest) showMemberPopup(map, latest)
        })
        // the dot's middle on the position, the age hanging under it
        mk = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -13] })
        mk.setLngLat([m.pos.lon, m.pos.lat]).addTo(map)
        markers.set(mid, mk)
      }
      const age = now - m.pos.ts
      const el = mk.getElement()
      mk.setLngLat([m.pos.lon, m.pos.lat])
      el.style.setProperty('--pt', memberColour(m.mid))
      el.style.opacity = String(Math.max(0.5, 1 - age / (4 * 3600_000)))
      // past two hours: a ring, and their scent no longer counts
      el.classList.toggle('pt-old', age > SCENT_FRESH_MS)
      el.querySelector('b')!.textContent = m.who.slice(0, 3)
      el.querySelector('small')!.textContent = ageShort(age)
      el.title = `${m.who}, placed ${agoLabel(age)}`
    }
  }
  for (const [mid, mk] of markers) {
    if (here.has(mid)) continue
    mk.remove()
    markers.delete(mid)
  }
}

let wired = false
export function initPartyLayer(): void {
  if (wired) return
  wired = true
  let current: MlMap | null = null
  onEachMap((map) => {
    current = map
    sync(map)
  })
  usePartyStore.subscribe((s, p) => {
    if (s.members !== p.members || s.party !== p.party) sync(current)
  })
  // the ages under the dots move on
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && usePartyStore.getState().party) sync(current)
  }, 30_000)
}
