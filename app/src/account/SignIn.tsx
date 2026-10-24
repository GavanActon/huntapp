import { useState, type JSX } from 'react'
import { useExplore } from '../explore/store'
import { sendCode, verifyCode } from './session'
import { syncLocations } from './sync'
import './account.css'

/**
 * Sign in: the email, a 6-digit code sent to it, typed here (account/session.ts). The Account
 * sheet holds it, and the HD card where HD needs an account (explore/BoxCard.tsx). Signed in, the
 * phone's locations and the account's are merged (account/sync.ts) before `onDone` hears how many
 * came onto this phone.
 */
export default function SignIn({ onDone, cta = 'Send me a code' }: { onDone?: (added: number) => void; cta?: string }): JSX.Element {
  // the address last typed for an ask, as a start
  const [email, setEmail] = useState(() => useExplore.getState().email)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const send = async () => {
    setBusy(true)
    setErr(null)
    const e = await sendCode(email)
    setBusy(false)
    if (e) return setErr(e)
    useExplore.getState().setEmail(email.trim())
    setSentTo(email.trim())
    setCode('')
  }

  const verify = async () => {
    setBusy(true)
    setErr(null)
    const e = await verifyCode(sentTo!, code)
    if (e) {
      setBusy(false)
      return setErr(e)
    }
    const r = await syncLocations()
    setBusy(false)
    onDone?.(r?.added ?? 0)
  }

  if (!sentTo) {
    return (
      <div className="signin">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && emailOk && !busy) void send()
          }}
        />
        <button className="btn-primary" disabled={!emailOk || busy} onClick={() => void send()}>
          {busy ? 'Sending…' : cta}
        </button>
        {err && <div className="signin-err">{err}</div>}
      </div>
    )
  }
  return (
    <div className="signin">
      <div className="dim signin-note">We sent a 6-digit code to {sentTo}. It works for 15 minutes.</div>
      <input
        className="signin-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={7}
        placeholder="123456"
        aria-label="The 6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && code.length === 6 && !busy) void verify()
        }}
      />
      <button className="btn-primary" disabled={code.length !== 6 || busy} onClick={() => void verify()}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {err && <div className="signin-err">{err}</div>}
      <div className="signin-again dim">
        <button className="linklike" disabled={busy} onClick={() => void send()}>
          Send a new code
        </button>{' '}
        ·{' '}
        <button className="linklike" disabled={busy} onClick={() => setSentTo(null)}>
          Another email
        </button>
      </div>
    </div>
  )
}
