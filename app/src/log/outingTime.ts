/**
 * How the log tells one outing from the next: a run of events (track
 * points, heard sounds, wind checks) with no gap over OUTING_GAP_MS is one
 * outing. A sound within LIVE_SOUND_MS is still live for the card.
 */

export const OUTING_GAP_MS = 2 * 3600_000
export const LIVE_SOUND_MS = 45 * 60_000

/** `stamps` sorted ascending: the start of the newest run with no gap over OUTING_GAP_MS; null when empty. */
export function outingSince(stamps: number[]): number | null {
  if (stamps.length === 0) return null
  let since = stamps[stamps.length - 1]
  for (let i = stamps.length - 2; i >= 0; i--) {
    if (since - stamps[i] > OUTING_GAP_MS) break
    since = stamps[i]
  }
  return since
}
