import { create } from 'zustand'
import { onEachMap } from './mapController'

/**
 * Which way is up on the map, to the degree: 0 north up, otherwise the
 * bearing the map is turned to (heading up, or a two-finger turn). For
 * what sits over the map and points a way, like the wind arrows, so they
 * read against the map as it is turned and not against a north that is
 * no longer at the top.
 */
export const useMapBearing = create<{ bearing: number }>(() => ({ bearing: 0 }))

onEachMap((map) => {
  const apply = () => {
    const bearing = Math.round(map.getBearing())
    if (bearing !== useMapBearing.getState().bearing) useMapBearing.setState({ bearing })
  }
  map.on('rotate', apply)
  apply()
})
