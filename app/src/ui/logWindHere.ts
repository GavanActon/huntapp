import { inRegion } from '../config'
import { useAppStore } from '../state/appStore'
import { useGpsStore } from '../tracking/gpsStore'
import { stripSubject } from './WeatherStrip'
import { useCheckForm } from './WindCheckCard'

/** Open the wind-check form at the phone's fix, or the strip's place, and drop any sheet. */
export function logWindHere(): void {
  const fix = useGpsStore.getState().fix
  if (fix && inRegion(fix.lon, fix.lat)) useCheckForm.getState().open(fix.lon, fix.lat, 'here')
  else {
    const s = stripSubject()
    useCheckForm.getState().open(s.lon, s.lat, s.name)
  }
  useAppStore.getState().closeSheet()
}
