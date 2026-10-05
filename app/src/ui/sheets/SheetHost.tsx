import { lazy, Suspense, type JSX, type ReactNode } from 'react'
import { SHEET_HALF_PCT, topSheet, useAppStore, type Sheet, type SheetKind } from '../../state/appStore'
import BottomSheet from '../BottomSheet'

const DigInSheet = lazy(() => import('./DigInSheet'))
const ScoringSheet = lazy(() => import('./ScoringSheet'))
const PinsSheet = lazy(() => import('./PinsSheet'))
const HuntLogSheet = lazy(() => import('./HuntLogSheet'))
const SettingsSheet = lazy(() => import('./SettingsSheet'))
const GuideSheet = lazy(() => import('./GuideSheet'))
const ButtonsSheet = lazy(() => import('./ButtonsSheet'))
const ViewsSheet = lazy(() => import('./ViewsSheet'))
const OfflineSheet = lazy(() => import('./OfflineSheet'))
const LayersSheet = lazy(() => import('./LayersSheet'))
const CoordsSheet = lazy(() => import('./CoordsSheet'))
const LocationsSheet = lazy(() => import('./LocationsSheet'))
const SatSheet = lazy(() => import('./SatSheet'))

/** '' where the panel draws its own `.sheet-head` as the first row of its body. */
const TITLES: Record<SheetKind, string> = {
  digin: '',
  scoring: 'Scoring',
  pins: 'Pins',
  huntlog: 'Hunt log',
  settings: 'Settings',
  guide: 'HuntOS',
  buttons: '',
  views: '',
  offline: 'Maps on this phone',
  layers: '',
  coords: 'Go to coordinates',
  locations: 'Locations',
  sat: 'Weather by satellite',
}

function panel(s: Sheet): ReactNode {
  switch (s.kind) {
    case 'digin':
      return <DigInSheet lon={s.lon} lat={s.lat} />
    case 'scoring':
      return <ScoringSheet lon={s.lon} lat={s.lat} />
    case 'pins':
      return <PinsSheet />
    case 'huntlog':
      return <HuntLogSheet />
    case 'settings':
      return <SettingsSheet />
    case 'guide':
      return <GuideSheet />
    case 'buttons':
      return <ButtonsSheet />
    case 'views':
      return <ViewsSheet />
    case 'offline':
      return <OfflineSheet />
    case 'layers':
      return <LayersSheet />
    case 'coords':
      // keyed by its text: opened again on another point, it starts afresh
      return <CoordsSheet key={s.text ?? ''} text={s.text} />
    case 'locations':
      return <LocationsSheet />
    case 'sat':
      return <SatSheet />
  }
}

/**
 * The one bottom sheet: whatever is on top of the sheet stack, with ‹ Back
 * when something is under it. A sheet closes on a tap off it (BottomSheet),
 * so nothing here has a ×.
 */
export default function SheetHost(): JSX.Element | null {
  const sheet = useAppStore(topSheet)
  const depth = useAppStore((s) => s.sheets.length)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const popSheet = useAppStore((s) => s.popSheet)
  if (!sheet) return null
  const stacked = depth > 1
  const action =
    sheet.kind === 'settings' || sheet.kind === 'guide' ? (
      <button className="sheet-done" onClick={closeSheet}>
        Done
      </button>
    ) : undefined
  // Map buttons and Views draw their own heading row, Done in it (back to Settings): no host row, no ‹ Back
  const own = sheet.kind === 'buttons' || sheet.kind === 'views'
  return (
    <BottomSheet
      snapKey={sheet.kind}
      halfPct={SHEET_HALF_PCT[sheet.kind]}
      onClose={closeSheet}
      onBack={stacked && !own ? popSheet : undefined}
      title={TITLES[sheet.kind]}
      action={action}
    >
      <Suspense fallback={<div className="empty">…</div>}>{panel(sheet)}</Suspense>
    </BottomSheet>
  )
}
