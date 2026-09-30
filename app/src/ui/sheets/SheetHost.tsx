import { lazy, Suspense, type JSX, type ReactNode } from 'react'
import { SHEET_HALF_PCT, topSheet, useAppStore, type Sheet, type SheetKind } from '../../state/appStore'
import BottomSheet from '../BottomSheet'

const DigInSheet = lazy(() => import('./DigInSheet'))
const ScoringSheet = lazy(() => import('./ScoringSheet'))
const PinsSheet = lazy(() => import('./PinsSheet'))
const HuntLogSheet = lazy(() => import('./HuntLogSheet'))
const SettingsSheet = lazy(() => import('./SettingsSheet'))
const ButtonsSheet = lazy(() => import('./ButtonsSheet'))
const OfflineSheet = lazy(() => import('./OfflineSheet'))
const LayersSheet = lazy(() => import('./LayersSheet'))

/** '' where the panel draws its own `.sheet-head` as the first row of its body. */
const TITLES: Record<SheetKind, string> = {
  digin: '',
  scoring: 'Scoring',
  pins: 'Pins',
  huntlog: 'Hunt log',
  settings: 'Settings',
  buttons: '',
  offline: 'Maps on this phone',
  layers: '',
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
    case 'buttons':
      return <ButtonsSheet />
    case 'offline':
      return <OfflineSheet />
    case 'layers':
      return <LayersSheet />
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
    sheet.kind === 'settings' ? (
      <button className="sheet-done" onClick={closeSheet}>
        Done
      </button>
    ) : undefined
  // Map buttons draws its own heading row, Done in it (back to Settings): no host row, no ‹ Back
  const own = sheet.kind === 'buttons'
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
