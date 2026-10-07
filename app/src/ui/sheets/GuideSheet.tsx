import type { JSX } from 'react'
import GuideSection from '../panels/GuideSection'
import './settings.css'

/**
 * How we hunt here, the field guide, as its own sheet from the ⋯ menu, beside
 * Settings. The host draws the title row and its Done; the guide itself
 * (folded sections and a search) is GuideSection.
 */
export default function GuideSheet(): JSX.Element {
  return (
    <div className="settings">
      <GuideSection />
    </div>
  )
}
