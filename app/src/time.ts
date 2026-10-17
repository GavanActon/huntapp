/**
 * Shared time helpers — one clock vocabulary for the whole app.
 *
 * The app has a single "planning time" (appStore.planTimeMs, null = now).
 * These helpers format and bucket moments consistently everywhere it shows:
 * the outlook strip, the trip chip, the verdict card and the timeline.
 */

/** Local midnight of the day containing `ms`. */
export function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isToday(ms: number): boolean {
  return startOfDayMs(ms) === startOfDayMs(Date.now())
}

// One formatter each, built once. Constructing an Intl.DateTimeFormat is the
// expensive part (locale data lookup) and toLocale*String builds a fresh one
// per call — these run for every strip hour, leg label and log row on the way
// up. Same locale, same options, so the strings are the ones they always were.
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

/** "9:45 AM" */
export function timeLabel(ms: number): string {
  return timeFmt.format(new Date(ms))
}

/** "Aug 24" */
export function dateShort(ms: number): string {
  return dateFmt.format(new Date(ms))
}

/** "Sat" */
export function dayShort(ms: number): string {
  return dayFmt.format(new Date(ms))
}

/** "Today" for today, otherwise "Sat". */
export function dayLabel(ms: number): string {
  return isToday(ms) ? 'Today' : dayShort(ms)
}

/** "9:45 AM" today, "Sat 9:45 AM" any other day. */
export function dayTimeLabel(ms: number): string {
  return isToday(ms) ? timeLabel(ms) : `${dayShort(ms)} ${timeLabel(ms)}`
}

/** When a note was written: "9:45 AM" today, "Sat 9:45 AM" this past week, "Oct 3, 9:45 AM" before. */
export function stampLabel(ms: number): string {
  return Date.now() - ms < 6 * 86_400_000 ? dayTimeLabel(ms) : `${dateShort(ms)}, ${timeLabel(ms)}`
}

/** Compact hour: "8a", "1p". */
export function hourShort(ms: number): string {
  const h = new Date(ms).getHours()
  return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`
}

/** Clock with no suffix: "7:30", "6:05". */
export function clockShort(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Hour with its half of the day: "7 pm", "11 am". */
export function hourAmPm(ms: number): string {
  const h = new Date(ms).getHours()
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
}

/** Compact clock: "4:40p", "2:10p". */
export function hourMinShort(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
}

/** Weekday and day of month: "Sun 27". */
export function dayDate(ms: number): string {
  return `${dayShort(ms)} ${new Date(ms).getDate()}`
}

/** Top of the current hour. */
export function floorHourMs(ms = Date.now()): number {
  const d = new Date(ms)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

/** Compact duration: "30 min", "1 h", "1½ h", "2 h". Never "30m": it sits beside distances,
 *  where it reads as metres (Gavan, 2026-10-17, the unit pass). */
export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h}${min % 60 >= 30 ? '½' : ''} h`
}

/** "just now", "12 min ago", "3 h ago", "2 d ago" — for data-freshness rows. */
export function agoLabel(ms: number): string {
  if (!Number.isFinite(ms)) return 'never'
  const min = Math.round(ms / 60_000)
  if (min < 2) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
