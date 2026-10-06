import { useEffect, useState, type JSX } from 'react'
import { onShareChange, setShare, shareState } from '../weather/micro/checkShare'

/**
 * The one time the app asks about sharing wind checks: on the card after a
 * check is saved, until it is answered (weather/micro/checkShare.ts). Share
 * or Not now; either way it is not asked again, and Settings → Sharing
 * changes it. Answered, one line says where.
 */
export default function ShareChecksAsk(): JSX.Element | null {
  const [state, setState] = useState(shareState)
  const [answered, setAnswered] = useState(false)
  useEffect(() => onShareChange(() => setState(shareState())), [])

  if (answered) {
    return <div className="gc-note">{state === 'on' ? 'Sharing your checks, this one and the ones before it · off any time in Settings' : 'Your checks stay on this phone · Settings can share them later'}</div>
  }
  if (state !== 'ask') return null
  const answer = (v: 'on' | 'off') => {
    setAnswered(true)
    setShare(v, 'ask')
  }
  return (
    <>
      <div className="gc-line">
        <b>Share your wind checks?</b> They go without your name or notes and teach the wind map where it's wrong, for every hunter. Other hunters never see where you checked.
      </div>
      <div className="gc-opts">
        <button className="btn-primary" onClick={() => answer('on')}>
          Share
        </button>
        <button className="chip-pick" onClick={() => answer('off')}>
          Not now
        </button>
      </div>
    </>
  )
}
