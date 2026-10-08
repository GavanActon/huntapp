import { lazy, Suspense, type JSX } from 'react'
import { useAppStore } from '../state/appStore'

const ScentCard = lazy(() => import('./ScentCard'))
const OutingCard = lazy(() => import('./OutingCard'))

/**
 * The card that takes the live card's slot under the strip: your scent in
 * full, or an outing from the Hunt log. The columns stay where they are,
 * and a tap off the card (the map) closes it, like everything else (tapOff);
 * ‹ Back is the same way out with a name on it.
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
