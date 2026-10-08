/**
 * The first view's inputs, asked for the moment the app runs, before the
 * map exists: the area's file list, the wind grid's base bands (the page
 * may have their first range in flight already, index.html), the habitat
 * grid, the wind field and the air's profile. They used to wait on the
 * map's first settled frame, three to six seconds into a cold open, and
 * then shared the line with the tiles (2026-10-07).
 */
import { loadHabitat } from '../spots/habitatGrid'
import { ensureProfile } from '../weather/boundaryLayer'
import { loadMicro, microBaseReady } from '../weather/micro/model'
import { ensureWeatherGrid } from '../weather/windGrid'
import { bootManifest } from './updates'

let done = false

export function warmStart(): void {
  if (done) return
  done = true
  void bootManifest()
  void ensureWeatherGrid()
  void ensureProfile()
  void loadMicro()
  // the wind grid's preview and base bands have the line to themselves
  // first (beside the map's tiles); the habitat grid, which only the heat
  // waits for, follows them rather than halving their share of it
  void microBaseReady().then(() => loadHabitat())
}
