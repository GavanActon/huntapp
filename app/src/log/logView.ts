import { useAppStore } from '../state/appStore'

/**
 * How the Hunt log is being looked at: the filter on top and which days
 * are open. Kept here, not in the sheet, so a trip into an outing and back
 * finds the log as it was left; a button that opens the log sets it fresh.
 * Session only.
 */

/** The filter chips: everything, or one kind of event. */
export type LogFilter = 'all' | 'heard' | 'seen' | 'sign' | 'blank' | 'wind' | 'outings'

export const LOG_FILTERS: readonly LogFilter[] = ['all', 'heard', 'seen', 'sign', 'blank', 'wind', 'outings']

export const LOG_FILTER_NAMES: Record<LogFilter, string> = {
  all: 'All',
  heard: 'Heard',
  seen: 'Seen',
  sign: 'Sign',
  blank: 'Blank sits',
  wind: 'Wind checks',
  outings: 'Outings',
}

/** null `open`: the default, today open and every other day folded. */
export const logView: { filter: LogFilter; open: number[] | null } = { filter: 'all', open: null }

/** Open the Hunt log fresh on `filter`: the Heard button's drawer opens it on
 *  what was heard, Sharpen's on the wind checks, the ⋯ menu on everything. */
export function openHuntLog(filter: LogFilter = 'all'): void {
  logView.filter = filter
  logView.open = null
  useAppStore.getState().openSheet({ kind: 'huntlog' })
}
