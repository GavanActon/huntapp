/**
 * Who is there and who may be hunted, when: the species table the range
 * gate and the season lines read, by jurisdiction and hunting zone. Kept by
 * hand from each regulation book, as no open machine-readable source of
 * seasons exists (docs/research/reports/Mountain hunt habitat rules.md).
 *
 * An area whose zone has no entry here scores every target as before, with
 * no season lines. Each entry names its edition and the day it was read;
 * the app says to check the current regulations and never reads as the law.
 * To add a zone: copy an entry, fill it from the synopsis, name the edition.
 */

/** The species the targets are made of (spots/profile.ts TARGET_MEMBERS),
 *  plus the ones the app only speaks of (caribou, sheep, goat, wolf). */
export type Quarry = 'moose' | 'deer' | 'blackBear' | 'grizzly' | 'grouse' | 'ptarmigan' | 'caribou' | 'sheep' | 'goat' | 'wolf'

/**
 * - hunted: an open season for residents
 * - restraint: legally open, but the managers ask hunters not to
 * - draw: by draw or permit only
 * - noSeason: there, but no season (or closed)
 * - absent: not there
 */
export type QuarryStatus = 'hunted' | 'restraint' | 'draw' | 'noSeason' | 'absent'

/** A season, 'MM-DD' to 'MM-DD' inclusive; `to` before `from` runs over New Year. */
export interface Season {
  from: string
  to: string
  /** what is legal in it: 'spike-fork, tripalm or 10-point bulls only' */
  what?: string
}

export interface QuarryRule {
  status: QuarryStatus
  seasons?: Season[]
  /** one line for the verdict's notes */
  note?: string
}

export interface ZoneRegs {
  jurisdiction: string
  /** the zone names as the area files have them (zone.name) */
  zones: string[]
  /** the regulation book read */
  edition: string
  /** the day it was read */
  checked: string
  url: string
  quarry: Partial<Record<Quarry, QuarryRule>>
  /** lines every hunt verdict in the zone carries */
  notes?: string[]
}

export const REGS: ZoneRegs[] = [
  {
    jurisdiction: 'BC',
    zones: ['6-28'],
    edition: 'BC Hunting & Trapping Regulations Synopsis 2026–2028, Region 6',
    checked: '2026-10-08',
    url: 'https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-region-6-skeena.pdf',
    quarry: {
      moose: {
        status: 'hunted',
        seasons: [
          { from: '08-23', to: '08-31', what: 'any bull' },
          { from: '09-01', to: '10-31', what: 'spike-fork, tripalm or 10-point bulls only' },
        ],
        note: 'Haines Highway Area Moose Restricted Area (Map F39).',
      },
      blackBear: {
        status: 'hunted',
        seasons: [
          { from: '04-01', to: '06-30' },
          { from: '08-15', to: '11-30' },
        ],
        note: 'Two a year; no glacier (blue) phase, no cubs or bears with them.',
      },
      grizzly: { status: 'noSeason', note: 'No grizzly season anywhere in BC (closed 2017).' },
      grouse: { status: 'hunted', seasons: [{ from: '09-10', to: '11-15', what: 'ruffed, spruce and dusky, 10 a day (bow only 1–9 Sept)' }] },
      ptarmigan: { status: 'hunted', seasons: [{ from: '08-15', to: '02-28', what: '10 a day' }] },
      deer: { status: 'noSeason' },
      caribou: { status: 'noSeason' },
      sheep: { status: 'draw', seasons: [{ from: '08-01', to: '10-15', what: 'Tatshenshini draw, full curl' }] },
      goat: { status: 'hunted', seasons: [{ from: '08-01', to: '10-15' }] },
      wolf: { status: 'hunted', seasons: [{ from: '08-01', to: '06-15' }] },
    },
    notes: ['Inside Tatshenshini-Alsek Park, no hunting within 400 m of the highway; anywhere, none from its 15 m road allowance.'],
  },
  {
    jurisdiction: 'YT',
    zones: ['4-09'],
    edition: 'Yukon Hunting Regulations Summary 2026–27',
    checked: '2026-10-08',
    url: 'https://emrlibrary.gov.yk.ca/emrlibrary/environment/yukon-hunting-regulations-summary/2026-27.pdf',
    quarry: {
      moose: { status: 'hunted', seasons: [{ from: '08-01', to: '10-31', what: 'one male' }] },
      blackBear: {
        status: 'hunted',
        seasons: [
          { from: '04-15', to: '06-21' },
          { from: '08-01', to: '11-15' },
        ],
        note: 'Two a year; no cubs or females with cubs.',
      },
      grizzly: {
        status: 'hunted',
        seasons: [
          { from: '04-15', to: '06-21' },
          { from: '08-01', to: '11-15' },
        ],
        note: 'One every three licence years; no cubs or females with cubs; no bait.',
      },
      grouse: { status: 'hunted', seasons: [{ from: '09-01', to: '11-30', what: 'spruce and ruffed 10 a day, dusky and sharp-tailed 5' }] },
      ptarmigan: { status: 'hunted', seasons: [{ from: '09-01', to: '03-15', what: '10 a day' }] },
      deer: { status: 'draw', seasons: [{ from: '08-01', to: '11-30', what: 'by lottery permit' }] },
      caribou: {
        status: 'restraint',
        seasons: [{ from: '08-01', to: '10-31' }],
        note: 'Ethel Lake caribou: open, but the Yukon, the Mayo District RRC and Na-Cho Nyäk Dun ask hunters not to take them.',
      },
      sheep: { status: 'hunted', seasons: [{ from: '08-01', to: '10-31', what: 'full curl or 8 years and older' }] },
      goat: { status: 'noSeason' },
      wolf: { status: 'hunted', seasons: [{ from: '08-01', to: '03-31' }] },
    },
    notes: ['Category A settlement land needs the First Nation’s written consent to hunt.'],
  },
]

export function regsFor(jurisdiction: string, zone: string): ZoneRegs | null {
  return REGS.find((r) => r.jurisdiction === jurisdiction && r.zones.includes(zone)) ?? null
}

const mmdd = (month: number, day: number) => `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

function inSeason(s: Season, today: string): boolean {
  return s.from <= s.to ? today >= s.from && today <= s.to : today >= s.from || today <= s.to
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
export function dayWords(md: string): string {
  return `${+md.slice(3)} ${MONTHS[+md.slice(0, 2) - 1]}`
}

/** A species' season on a date: open (and the season it is in), or shut
 *  and when the next one opens. Null when the table has no dates for it. */
export function seasonOn(rule: QuarryRule | undefined, month: number, day: number): { open: boolean; season?: Season; next?: Season } | null {
  if (!rule?.seasons?.length) return null
  const today = mmdd(month, day)
  const now = rule.seasons.find((s) => inSeason(s, today))
  if (now) return { open: true, season: now }
  // the next to open: the first `from` after today, else the year's first
  const sorted = [...rule.seasons].sort((a, b) => (a.from < b.from ? -1 : 1))
  return { open: false, next: sorted.find((s) => s.from > today) ?? sorted[0] }
}
