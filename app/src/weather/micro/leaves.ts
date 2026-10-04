import { ACTIVE_AREA, type AreaLeaves } from '../../areas'
import { useAppStore } from '../../state/appStore'

/**
 * The hardwoods' leaves, for the ground wind. Both point clouds were flown
 * in leaf (Pickle Lake in September 2021, Lac Bailey in July and September
 * 2024), so the closure they measured is a summer canopy's: hardwood and
 * mixed stands read about 15 points more closed than once the leaves drop
 * (MICRO-WIND-LIDAR.md, Phase 2, As built). The micro grid carries the
 * head-height fraction both ways, `canopy` in leaf and `canopyBare` with
 * the hardwood share of the closure down to bare branches
 * (build_microclimate.py), and the model moves from one to the other by how
 * far the leaves are down (model.ts canopyAt), so the ground wind, the
 * scent cone and the heat map follow the season. Conifer barely moves and
 * open ground not at all; the roughness stays leaf-on.
 *
 * By the local date: in full leaf until fallStart, falling evenly to bare
 * by fallBare, bare through the winter, coming out from springStart to full
 * leaf by springFull. The defaults are the boreal's at about 49° N: aspen
 * and birch turn in the last third of September and are bare by
 * mid-October (Gavan's word for it), and leaf out through May. An area may
 * set its own days (`leaves` in src/areas/<id>.json); both use these.
 */
export const LEAF_DAYS: AreaLeaves = { springStart: '05-10', springFull: '06-05', fallStart: '09-20', fallBare: '10-15' }

const DAY_MS = 86_400_000

/** Days into the year (0 on 1 January); rounded, so a clock change between doesn't matter. */
function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((new Date(year, month - 1, day).getTime() - new Date(year, 0, 1).getTime()) / DAY_MS)
}

const dayOf = (year: number, mmdd: string) => dayOfYear(year, Number(mmdd.slice(0, 2)), Number(mmdd.slice(3, 5)))

/** How far the leaves are down on a moment's local date, 0 in full leaf to
 *  1 bare, and whether they are falling (else coming out, or neither). */
function season(ms: number, days: AreaLeaves): { off: number; falling: boolean } {
  const d = new Date(ms)
  const y = d.getFullYear()
  const today = dayOfYear(y, d.getMonth() + 1, d.getDate())
  // the area check holds the four days in order, so neither ramp is empty
  const fall = dayOf(y, days.fallStart)
  if (today >= fall) return { off: Math.min(1, (today - fall) / (dayOf(y, days.fallBare) - fall)), falling: true }
  const spring = dayOf(y, days.springStart)
  if (today >= spring) return { off: Math.max(0, 1 - (today - spring) / (dayOf(y, days.springFull) - spring)), falling: false }
  return { off: 1, falling: false }
}

/** How far the hardwoods' leaves are down on a moment's local date: 0 in
 *  full leaf, 1 bare. */
export function leafOff(ms: number, days: AreaLeaves = ACTIVE_AREA.leaves ?? LEAF_DAYS): number {
  return season(ms, days).off
}

/** The share of the way to bare branches the ground wind takes at a
 *  moment: the knob's On (0) or Down (1), else the date's. */
export function leavesDown(ms: number): number {
  const mode = useAppStore.getState().leaves
  return mode === 'on' ? 0 : mode === 'down' ? 1 : leafOff(ms)
}

/** What Auto gives at a moment, for the knob: in leaf, falling, down or coming out. */
export function leavesWord(ms: number): string {
  const { off, falling } = season(ms, ACTIVE_AREA.leaves ?? LEAF_DAYS)
  return off <= 0 ? 'in leaf' : off >= 1 ? 'down' : falling ? 'falling' : 'coming out'
}

/** The ground wind's words in a stand whose leaves matter, once they are
 *  more down than on: "leaves down", or on the way, "most leaves down" in
 *  the fall and "leaves barely out" in the spring. Null while they are
 *  mostly on. */
export function leavesNote(ms: number): string | null {
  const mode = useAppStore.getState().leaves
  if (mode === 'on') return null
  if (mode === 'down') return 'leaves down'
  const { off, falling } = season(ms, ACTIVE_AREA.leaves ?? LEAF_DAYS)
  if (off <= 0.5) return null
  return off >= 1 ? 'leaves down' : falling ? 'most leaves down' : 'leaves barely out'
}
