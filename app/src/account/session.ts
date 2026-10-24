import { create } from 'zustand'
import { API } from '../analytics'
import { devlog, installId } from '../devlog'

/**
 * Signed in or not (docs/REQUESTS.md, Accounts; Gavan, 2026-10-24: "an email and a 6-digit
 * code, no password"). Asked for only when something must find the hunter later or follow them:
 * HD, their locations on another device, the Home Screen app (whose storage an iPhone keeps apart
 * from Safari's). A code, not a link, because a link in an email opens in Safari, never in the
 * Home Screen app. The Worker's side is site/account.js; the session it hands back is a long
 * random token, kept here and sent as `Authorization: Bearer`.
 */

const KEY = 'huntapp-session'

interface Kept {
  token: string
  email: string
}

function readKept(): Kept | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Kept | null
    return v && typeof v.token === 'string' && typeof v.email === 'string' ? v : null
  } catch {
    return null
  }
}

interface SessionState {
  email: string | null
  token: string | null
}

export const useSession = create<SessionState>(() => {
  const k = readKept()
  return { email: k?.email ?? null, token: k?.token ?? null }
})

/** The header a request carries when the phone is signed in; none when not. */
export function authHeaders(): Record<string, string> {
  const t = useSession.getState().token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export const signedIn = (): boolean => useSession.getState().token != null

/** What an answer from the account routes says, in words for the sheet. */
function why(e: string | undefined, left?: number): string {
  switch (e) {
    case 'email':
      return 'That email address does not look right.'
    case 'busy':
      return 'Too many codes asked for just now: try again in an hour.'
    case 'expired':
      return 'That code has run out: ask for a new one.'
    case 'tries':
      return 'Too many tries with that code: ask for a new one.'
    case 'code':
      return left != null && left > 0 ? `Not the code we sent. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Not the code we sent.'
    case 'accounts':
      return 'Sign-in is not switched on yet: try again later.'
    default:
      return navigator.onLine ? 'Something went wrong: try again.' : 'No signal: signing in needs one.'
  }
}

async function post(path: string, body: unknown, auth = false): Promise<{ ok: boolean; j: Record<string, unknown> }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? authHeaders() : {}) },
      body: JSON.stringify(body),
    })
    const j = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    return { ok: res.ok, j }
  } catch {
    return { ok: false, j: {} }
  }
}

/** A code to this address. Null when it went, else why not, in words. */
export async function sendCode(email: string): Promise<string | null> {
  const { ok, j } = await post('/api/auth/start', { email: email.trim() })
  devlog('account', `code asked · ${ok ? 'sent' : String(j.error ?? 'failed')}`)
  return ok ? null : why(j.error as string | undefined)
}

/** The code typed: signed in when it is right. Null when signed in, else why not, in words. */
export async function verifyCode(email: string, code: string): Promise<string | null> {
  const { ok, j } = await post('/api/auth/verify', { email: email.trim(), code: code.replace(/\D/g, ''), install: installId() })
  if (!ok || typeof j.token !== 'string') {
    devlog('account', `code tried · ${String(j.error ?? 'failed')}`)
    return why(j.error as string | undefined, typeof j.left === 'number' ? j.left : undefined)
  }
  const kept: Kept = { token: j.token, email: typeof j.email === 'string' ? j.email : email.trim().toLowerCase() }
  try {
    localStorage.setItem(KEY, JSON.stringify(kept))
  } catch {
    /* signed in for this run */
  }
  useSession.setState(kept)
  devlog('account', 'signed in')
  return null
}

/** Signed out here: the session ends at the Worker too, when there is signal. */
export async function signOut(): Promise<void> {
  if (useSession.getState().token) void post('/api/auth/out', {}, true)
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* gone for this run */
  }
  useSession.setState({ email: null, token: null })
  devlog('account', 'signed out')
}

/** The Worker no longer knows the session (signed out on another phone, lapsed): signed out here. */
export function sessionLost(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* gone for this run */
  }
  useSession.setState({ email: null, token: null })
  devlog('account', 'session lost')
}
