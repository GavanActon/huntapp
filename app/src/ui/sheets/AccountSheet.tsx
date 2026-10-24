import { type JSX } from 'react'
import { signOut, useSession } from '../../account/session'
import SignIn from '../../account/SignIn'
import { toast } from '../Toast'
import { useAppStore } from '../../state/appStore'

/**
 * Your account (docs/REQUESTS.md, Accounts): signed out, what it is for and the sign-in; signed in,
 * whose it is and Sign out. Nothing in the app needs it but HD; it carries the locations to every
 * phone signed in with the same email, the Home Screen app among them (an iPhone keeps that apart
 * from Safari).
 */
export default function AccountSheet(): JSX.Element {
  const email = useSession((s) => s.email)
  const closeSheet = useAppStore((s) => s.closeSheet)
  if (email) {
    return (
      <div className="account">
        <p>
          Signed in as <span className="account-who">{email}</span>.
        </p>
        <p className="dim">Your spots are on every phone you sign in on with this email, the Home Screen app too. Signing in keeps your spots, never where you are.</p>
        <button className="btn-secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    )
  }
  return (
    <div className="account">
      <p>Sign in to have your spots on every phone you use, and to ask for HD. No password: we email you a code.</p>
      <p className="dim">Signing in keeps your spots, never where you are.</p>
      <SignIn
        onDone={(added) => {
          closeSheet()
          // the area list is the start's: the locations from other phones come in with a reload
          if (added) toast(`${added} ${added === 1 ? 'spot' : 'spots'} from your other phones`, 10_000, { label: 'Show', run: () => window.location.reload() })
          else toast('Signed in', 2500)
        }}
      />
    </div>
  )
}
