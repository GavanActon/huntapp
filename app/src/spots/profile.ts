/**
 * The place, as the hunt rules need it: what no one cell of the grid says.
 * Every location-dependent choice in huntRules.ts reads this module and
 * nothing else, so a new area (or, later, an Explore tile) plugs in by
 * having a profile, not by an edit to the rules:
 *
 *  - the area file's `profile` (pipeline/build_profile.py): the treeline
 *    measured off its own grid, its ecoregion, whether the north's
 *    regrowth and rut calendar apply, what its stand map is good for;
 *  - the species table (spots/regs.ts) for its jurisdiction and zone: who
 *    is there, who may be hunted, when, and what is legal;
 *  - the calendar functions below, from the date alone.
 *
 * An area with neither scores as boreal Ontario did before profiles: no
 * treeline, the boreal calendars, every target present and no season lines.
 * docs/research/reports/Mountain hunt habitat rules.md has the research.
 */
import { ACTIVE_AREA } from '../areas'
import { dayWords, regsFor, seasonOn, type Quarry, type QuarryStatus, type ZoneRegs } from './regs'
import type { HuntTarget } from './types'

const P = ACTIVE_AREA.profile

export const PROFILE = {
  /** where the trees give out, m, and on north and south faces; null: forest to the tops */
  treeline: P?.treeline ?? null,
  /** the north's regrowth (the burn-browse peak at 11-30 yr) and its rut calendar */
  north: P?.north ?? false,
  /** the stand map measures shrub height (VRI, écoforestier) */
  shrubHeight: P?.stands.shrubHeight ?? false,
  /** the stand map's lead species is mapped, not inferred */
  leadSpecies: P?.stands.leadSpecies ?? true,
}

/** The area's zone in the species table; null where nobody has read its book in yet. */
export const REGS_HERE: ZoneRegs | null = regsFor(ACTIVE_AREA.jurisdiction, ACTIVE_AREA.zone.name)

/** The species each target stands for: the heat map is the best of them
 *  that may be hunted that day. */
export const TARGET_MEMBERS: Record<HuntTarget, Quarry[]> = {
  moose: ['moose'],
  deer: ['deer'],
  bear: ['blackBear', 'grizzly'],
  grouse: ['grouse', 'ptarmigan'],
}

export const QUARRY_NAMES: Record<Quarry, string> = {
  moose: 'moose',
  deer: 'deer',
  blackBear: 'black bear',
  grizzly: 'grizzly',
  grouse: 'grouse',
  ptarmigan: 'ptarmigan',
  caribou: 'caribou',
  sheep: 'sheep',
  goat: 'goat',
  wolf: 'wolf',
}

/** Whether a species is here: the table's word where it has one; else from
 *  the place (grizzlies in the north and the mountains, ptarmigan where
 *  there is ground above the trees); else null, assumed there as before. */
export function presence(q: Quarry): QuarryStatus | null {
  const r = REGS_HERE?.quarry[q]
  if (r) return r.status
  if (q === 'grizzly') return PROFILE.north ? null : 'absent'
  if (q === 'ptarmigan') return PROFILE.treeline ? null : 'absent'
  return null
}

function monthDay(timeMs: number): [number, number] {
  const d = new Date(timeMs)
  return [d.getMonth() + 1, d.getDate()]
}

/** The species a target is scored as on a day: the ones here that may be
 *  hunted and are in season (a season the table does not know counts as
 *  open). With none open, the ones that may be hunted at all, so the map
 *  still scouts, and `closed` says so; with none of those, all that are here. */
export function scoredMembers(t: HuntTarget, timeMs: number): { members: Quarry[]; closed: boolean } {
  const [m, d] = monthDay(timeMs)
  const here = TARGET_MEMBERS[t].filter((q) => presence(q) !== 'absent')
  const present = here.length ? here : TARGET_MEMBERS[t].slice(0, 1)
  const legal = present.filter((q) => presence(q) !== 'noSeason')
  const open = legal.filter((q) => seasonOn(REGS_HERE?.quarry[q], m, d)?.open ?? true)
  if (open.length) return { members: open, closed: false }
  return { members: legal.length ? legal : present, closed: legal.length > 0 }
}

/** A target as the quarry menu shows it: hidden where none of its species
 *  is here or may be hunted, else a word on how (null: plainly hunted). */
export function targetStanding(t: HuntTarget): { show: boolean; word: string | null } {
  const st = TARGET_MEMBERS[t].map(presence)
  if (st.every((s) => s === 'absent' || s === 'noSeason')) return { show: false, word: null }
  if (st.some((s) => s === 'hunted' || s == null)) {
    if (t === 'grouse' && presence('ptarmigan') !== 'absent' && presence('ptarmigan') !== 'noSeason') return { show: true, word: 'and ptarmigan' }
    if (t === 'bear' && presence('grizzly') === 'noSeason') return { show: true, word: 'black bear' }
    return { show: true, word: null }
  }
  return { show: true, word: st.includes('draw') ? 'permit only' : st.includes('restraint') ? 'asked not to' : null }
}

/** The season and legal lines a verdict carries for a target, and the
 *  zone's own: warnings when nothing it stands for is open, notes for
 *  what is legal today and for what managers ask. Empty where the zone has
 *  no entry, but for the grizzly kill-site card wherever grizzlies are. */
export function regsLines(t: HuntTarget, timeMs: number): { warnings: string[]; notes: string[] } {
  const warnings: string[] = []
  const notes: string[] = []
  const [m, d] = monthDay(timeMs)
  const { closed } = scoredMembers(t, timeMs)
  for (const q of TARGET_MEMBERS[t]) {
    const st = presence(q)
    if (st === 'absent' || st == null) continue
    const rule = REGS_HERE?.quarry[q]
    const name = QUARRY_NAMES[q]
    if (st === 'noSeason') {
      notes.push(rule?.note ?? `No ${name} season here.`)
      continue
    }
    const on = seasonOn(rule, m, d)
    if (on?.open) {
      if (on.season?.what) notes.push(`${name[0].toUpperCase()}${name.slice(1)} to ${dayWords(on.season.to)}: ${on.season.what}.`)
    } else if (on?.next) {
      const line = `${name[0].toUpperCase()}${name.slice(1)} closed here: opens ${dayWords(on.next.from)}${on.next.what ? ` (${on.next.what})` : ''}.`
      // a warning when nothing the target stands for is open; a note beside one that is
      ;(closed ? warnings : notes).push(line)
    }
    if (st === 'draw') notes.push(`${name[0].toUpperCase()}${name.slice(1)}: by draw or permit only.`)
    if (rule?.note) notes.push(rule.note)
  }
  if (REGS_HERE) {
    // what the managers ask of every hunter here (a herd to leave), and the zone's own lines
    for (const [q, r] of Object.entries(REGS_HERE.quarry) as [Quarry, NonNullable<ZoneRegs['quarry'][Quarry]>][]) {
      if (r.status === 'restraint' && r.note && !TARGET_MEMBERS[t].includes(q)) notes.push(r.note)
    }
    notes.push(...(REGS_HERE.notes ?? []))
  }
  if ((t === 'moose' || t === 'bear') && presence('grizzly') !== 'absent') {
    notes.push('Grizzly country: move the meat 200 m from the gut pile and hang it; come back from upwind and glass first; leave a kill that has been moved or buried.')
  }
  if (REGS_HERE) notes.push(`From the ${REGS_HERE.edition}, read ${dayWords(REGS_HERE.checked.slice(5))} ${REGS_HERE.checked.slice(0, 4)}: check the current regulations.`)
  return { warnings, notes }
}

/** Height over the treeline, m (negative below), per cell: the treeline
 *  of the way the slope faces where the profile measured north and south
 *  faces apart, else the one number. Null where the area has no treeline
 *  or the grid no elevation. `aspect` holds the uphill bearing ×250/360
 *  (255 flat); the slope faces 180° from it. */
export function treelineOffsets(elev: Uint16Array | null, aspect: Uint8Array, slope: Uint8Array): Float32Array | null {
  const T = PROFILE.treeline
  if (!T || !elev) return null
  const out = new Float32Array(elev.length)
  const split = T.north != null && T.south != null
  const mid = split ? (T.north! + T.south!) / 2 : T.m
  const half = split ? (T.south! - T.north!) / 2 : 0
  for (let i = 0; i < elev.length; i++) {
    let t = T.m
    if (split && aspect[i] !== 255 && slope[i] >= 5) {
      // uphill bearing: a north face's uphill is south, cos(uphill) = -1 there
      const up = (aspect[i] * (360 / 250) * Math.PI) / 180
      t = mid + half * Math.cos(up)
    }
    out[i] = elev[i] - t
  }
  return out
}

/** The day of year moose begin to feel the heat at the afternoon's
 *  temperature: 14 °C in the summer coat, about 10 °C once the winter coat
 *  is in (Renecker & Hudson; the fall ramp between is inference). */
export function heatOnsetC(doy: number): number {
  if (doy <= 258) return 14
  if (doy >= 274) return 10
  return 14 - (4 * (doy - 258)) / 16
}
