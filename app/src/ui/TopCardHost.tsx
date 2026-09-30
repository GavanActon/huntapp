import { lazy, Suspense, type JSX } from 'react'
import { useAppStore } from '../state/appStore'

const ScentCard = lazy(() => import('./ScentCard'))
const OutingCard = lazy(() => import('./OutingCard'))

/**
 * The card that takes the live card's slot under the strip: your scent in
 * full, or an outing from the Hunt log. It has ‹ Back, not a tap-off — the
 * map under it is the point — and the columns stay where they are.
 */
export default function TopCardHost(): JSX.Element | null {
  const card = useAppStore((s) => s.topCard)
  if (!card) return null
  return (
    <Suspense fallback={null}>
      {card.kind === 'scent' && <ScentCard />}
      {card.kind === 'outing' && <OutingCard id={card.id} />}
    </Suspense>
  )
}
