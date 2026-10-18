import type { ExpressionSpecification } from 'maplibre-gl'

/**
 * Property lines (Gavan, 2026-10-18: "need property lines ... marked up
 * automatically in an HD build"): whose land it is, from the bake's
 * property step (pipeline/build_property.py). Two themes in the places
 * archive:
 *   - `land`: polygons with a CLASS (private, a reserve, a park closed to
 *     hunting...) and HUNT (no | permission | rules | ask | open), NAME and SRC;
 *   - `lots`: the lot and parcel outlines with a LABEL ("Lot 5, Con 3,
 *     Jarvis", "NE 12-36-8-W5"), never an owner.
 * All from government open data: approximate (100 m in parts of Ontario),
 * not a survey, and land with no class can still be private (Quebec's lots
 * are not open). The Layers row says so; the map's tap names the class.
 * The old `crown` theme ("Private land") stays for packs baked before.
 */

export type LandClass =
  | 'private'
  | 'likely-private'
  | 'other-gov'
  | 'federal'
  | 'municipal'
  | 'reserve'
  | 'settlement-a'
  | 'settlement-b'
  | 'settlement-fs'
  | 'crown-lease'
  | 'closed'
  | 'restricted'

/** Each class in words, and what it means for a hunter, short. */
export const LAND_WORDS: Record<LandClass, { name: string; hunt: string }> = {
  private: { name: 'Private land', hunt: 'ask to hunt' },
  'likely-private': { name: 'Likely private', hunt: 'ask to hunt' },
  'other-gov': { name: 'Other government land', hunt: 'check access' },
  federal: { name: 'Federal land', hunt: 'check access' },
  municipal: { name: 'Municipal land', hunt: 'check access' },
  reserve: { name: 'Reserve', hunt: 'ask the First Nation' },
  'settlement-a': { name: 'Settlement land (Cat. A)', hunt: 'permission to hunt' },
  'settlement-b': { name: 'Settlement land (Cat. B)', hunt: 'check the rules' },
  'settlement-fs': { name: 'Settlement land (fee simple)', hunt: 'ask to hunt' },
  'crown-lease': { name: 'Crown land under lease', hunt: 'check access' },
  closed: { name: 'Closed to hunting', hunt: 'no hunting' },
  restricted: { name: 'Managed territory', hunt: 'its own rules' },
}

/** Which wins where two overlap at a tap: the one that says no first. */
const RANK: LandClass[] = ['closed', 'reserve', 'settlement-a', 'private', 'settlement-fs', 'likely-private', 'restricted', 'settlement-b', 'crown-lease', 'other-gov', 'federal', 'municipal']
export function landRank(c: string): number {
  const i = RANK.indexOf(c as LandClass)
  return i < 0 ? RANK.length : i
}

/** The colour of each class: private reds, government ambers, First Nations' violet, leases blue, closed a strong red-orange, managed green. */
const COLOURS: Record<LandClass, string> = {
  private: '255,110,110',
  'likely-private': '255,140,140',
  'other-gov': '255,190,90',
  federal: '255,190,90',
  municipal: '255,190,90',
  reserve: '190,140,255',
  'settlement-a': '190,140,255',
  'settlement-b': '210,180,255',
  'settlement-fs': '190,140,255',
  'crown-lease': '120,180,255',
  closed: '255,90,40',
  restricted: '120,220,120',
}

/** A class-by-class colour expression at an alpha. */
export function landColour(alpha: number): ExpressionSpecification {
  const pairs = (Object.keys(COLOURS) as LandClass[]).flatMap((k) => [k, `rgba(${COLOURS[k]},${alpha})`])
  return ['match', ['get', 'CLASS'], ...pairs, `rgba(255,255,255,${alpha})`] as unknown as ExpressionSpecification
}

/** The tap's line: "Private land · ask to hunt", a park's own name where it has one. */
export function landLine(props: { CLASS?: string; NAME?: string } | null): string | null {
  if (!props?.CLASS) return null
  const w = LAND_WORDS[props.CLASS as LandClass]
  if (!w) return null
  const name = props.NAME && (props.CLASS === 'closed' || props.CLASS === 'restricted' || props.CLASS === 'reserve') ? props.NAME : w.name
  return `${name} · ${w.hunt}`
}
