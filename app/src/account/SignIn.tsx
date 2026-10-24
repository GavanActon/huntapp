import { useEffect, useRef, useState, type JSX } from 'react'
import { useExplore } from '../explore/store'
import { sendCode, verifyCode } from './session'
import { syncLocations } from './sync'
import './account.css'

/**
 * Sign in: the email, a 6-digit code sent to it, typed or pasted here (account/session.ts). The
 * Account sheet holds it, and the HD card where HD needs an account (explore/BoxCard.tsx). Signed
 * in, the phone's locations and the account's are merged (account/sync.ts) before `onDone` hears
 * how many came onto this phone.
 *
 * The code is mostly copied from the email, not typed (Gavan, 2026-10-24: "had to scroll up because
 * it wanted me to type in the code - I'd copied it from my email"): the field takes the whole
 * email's words and finds the code in them, a Paste button fills it with no keyboard, six digits
 * sign in by themselves, and coming back from the mail app brings the field into view.
 */

/** The code in whatever was pasted or typed: a run of six digits standing alone ("Your Groundwind
 *  code is 482913."), else the first six digits typed. */
export function codeIn(text: string): string {
  const alone = /(?:^|\D)(\d{6})(?!\d)/.exec(text)
  return alone ? alone[1] : text.replace(/\D/g, '').slice(0, 6)
}

export default function SignIn({ onDone, cta = 'Send me a code' }: { onDone?: (added: number) => void; cta?: string }): JSX.Element {
  // the address last typed for an ask, as a start
  const [email, setEmail] = useState(() => useExplore.getState().email)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // the code last tried: a wrong one is not sent again by itself
  const tried = useRef('')
  const field = useRef<HTMLInputElement>(null)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  const send = async () => {
    setBusy(true)
    setErr(null)
    const e = await sendCode(email)
    setBusy(false)
    if (e) return setErr(e)
    useExplore.getState().setEmail(email.trim())
    setSentTo(email.trim())
    setCode('')
    tried.current = ''
  }

  const verify = async (c: string) => {
    if (busy || c.length !== 6) return
    tried.current = c
    setBusy(true)
    setErr(null)
    const e = await verifyCode(sentTo!, c)
    if (e) {
      setBusy(false)
      return setErr(e)
    }
    const r = await syncLocations()
    setBusy(false)
    onDone?.(r?.added ?? 0)
  }

  /** A code in: shown, and sent at once when it is a whole one not tried yet. */
  const take = (text: string) => {
    const c = codeIn(text)
    setCode(c)
    if (c.length === 6 && c !== tried.current) void verify(c)
  }

  const paste = async () => {
    try {
      take(await navigator.clipboard.readText())
    } catch {
      setErr('Could not read what was copied: paste it into the box instead.')
      field.current?.focus()
    }
  }

  // the code's field in view and ready as it appears, and again on coming back from the mail app
  useEffect(() => {
    if (!sentTo) return
    const show = () => {
      const el = field.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    const t = window.setTimeout(show, 120)
    const back = () => {
      if (document.visibilityState === 'visible') window.setTimeout(show, 250)
    }
    document.addEventListener('visibilitychange', back)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', back)
    }
  }, [sentTo])

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
      <div className="dim signin-note">We sent a 6-digit code to {sentTo}. Copy it from the email and paste it here; it works for 15 minutes.</div>
      <div className="signin-coderow">
        <input
          ref={field}
          className="signin-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          aria-label="The 6-digit code"
          value={code}
          onChange={(e) => take(e.target.value)}
          onPaste={(e) => {
            // the whole email's words pasted: the code found in them, not the first characters of it
            e.preventDefault()
            take(e.clipboardData.getData('text'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void verify(code)
          }}
        />
        {canPaste && (
          <button className="btn-secondary signin-paste" disabled={busy} onClick={() => void paste()}>
            Paste
          </button>
        )}
      </div>
      <button className="btn-primary" disabled={code.length !== 6 || busy} onClick={() => void verify(code)}>
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
