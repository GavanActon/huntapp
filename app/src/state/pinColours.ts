import type { PlaceDef } from '../config'

/** The colours a pin can be given (its popup, the Pins editor), and the one
 *  a kind gets until it is: the camp amber, lakes cyan, landings teal,
 *  stands red, trails gold. */
export const PIN_COLOURS = ['#ff8a80', '#ffb454', '#c9a227', '#9be36a', '#3fc8ff', '#59e0b8', '#e0a0ff', '#f4f1e8'] as const

export const KIND_COLOURS: Record<PlaceDef['kind'], string> = {
  camp: '#ffb454',
  lake: '#3fc8ff',
  landing: '#59e0b8',
  stand: '#ff8a80',
  trail: '#c9a227',
}

export const placeColour = (p: PlaceDef): string => p.color ?? KIND_COLOURS[p.kind] ?? '#ffb454'
