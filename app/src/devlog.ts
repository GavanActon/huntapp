/**
 * Dev log: a ring of timestamped lines kept in memory (and in localStorage
 * when switched on), for the bugs that leave no trace in the field.
 */
const ON_KEY = 'huntapp-devlog'
const LINES_KEY = 'huntapp-devlog-lines'
const MAX_LINES = 1000

let on = false
let lines: string[] = []
try {
  on = localStorage.getItem(ON_KEY) === '1'
  if (on) lines = JSON.parse(localStorage.getItem(LINES_KEY) ?? '[]')
} catch {
  /* private mode */
}

export function devlogOn(): boolean {
  return on
}
export function setDevlog(v: boolean) {
  on = v
  try {
    localStorage.setItem(ON_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}
export function devlog(tag: string, msg: string) {
  if (import.meta.env.DEV) console.debug(`[${tag}] ${msg}`)
  if (!on) return
  lines.push(`${new Date().toISOString().slice(11, 19)} ${tag} · ${msg}`)
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES)
  try {
    localStorage.setItem(LINES_KEY, JSON.stringify(lines))
  } catch {
    /* ignore */
  }
}
export function devlogLines(): string[] {
  return lines.slice()
}
