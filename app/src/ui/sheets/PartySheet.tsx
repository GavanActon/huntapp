import { useEffect, useMemo, useState, type JSX } from 'react'
import { renderSVG } from 'uqr'
import { getMap } from '../../map/mapController'
import { CODE_TAG, memberColour, partyCode, partyLink, readInvite, type PartyInvite } from '../../party/partyCode'
import { joinParty, leaveParty, membersList, poll, setPaused, startParty, usePartyStore, type Member } from '../../party/party'
import { SHARE_BASE, shareOrCopy } from '../../share/share'
import { useAppStore } from '../../state/appStore'
import { toggleLocate } from '../../tracking/gpsService'
import { useGpsStore } from '../../tracking/gpsStore'
import { agoLabel } from '../../time'
import { compass } from '../../weather/openMeteo'
import '../areas.css'
import '../party.css'

/**
 * Party (party/party.ts, docs/PARTY.md): hunting together. Out of a party:
 * Start one, or Join with a code (pasted, or brought by a link). In one:
 * the invite as a QR code to scan at camp, with Share and Copy code; who
 * is in it, where each was placed and how long ago (a tap flies there);
 * Share my position; Leave. Your initials are what the others see.
 */

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

function metresAndWay(from: { lon: number; lat: number }, to: { lon: number; lat: number }): { m: number; way: string } {
  const dx = (to.lon - from.lon) * 111_320 * Math.cos((from.lat * Math.PI) / 180)
  const dy = (to.lat - from.lat) * 110_574
  return { m: Math.hypot(dx, dy), way: compass(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) }
}

function distText(m: number, imperial: boolean): string {
  if (imperial) return m < 1609 ? `${Math.round(m / 0.9144 / 10) * 10} yd` : `${(m / 1609.34).toFixed(1)} mi`
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

function Initials(): JSX.Element {
  const who = useAppStore((s) => s.who)
  const setWho = useAppStore((s) => s.setWho)
  return (
    <label className="pt-initials">
      <span>Your initials</span>
      <input type="text" className="coords-box" value={who} maxLength={12} placeholder="GA" autoCapitalize="characters" onChange={(e) => setWho(e.target.value)} aria-label="Your initials" />
    </label>
  )
}

function MemberRow({ m, fixOf }: { m: Member; fixOf: { lon: number; lat: number } | null }): JSX.Element {
  const imperial = useAppStore((s) => s.units) === 'imperial'
  const closeSheet = useAppStore((s) => s.closeSheet)
  const now = Date.now()
  const where = m.pos ? [`placed ${agoLabel(now - m.pos.ts)}`, fixOf ? (({ m: d, way }) => `${distText(d, imperial)} ${way}`)(metresAndWay(fixOf, m.pos)) : null, m.pos.h > 2 ? `stand ${m.pos.h} m` : null].filter(Boolean).join(' · ') : 'no position yet'
  return (
    <button
      className="coords-row pt-member"
      disabled={!m.pos}
      onClick={() => {
        const map = getMap()
        if (!map || !m.pos) return
        closeSheet()
        map.flyTo({ center: [m.pos.lon, m.pos.lat], zoom: Math.max(map.getZoom(), 15) })
      }}
    >
      <span>
        <i className="pt-dot" style={{ background: memberColour(m.mid) }} />
        <b>{m.who}</b>
      </span>
      <span className="dim">{where}</span>
    </button>
  )
}

function JoinForm({ invite }: { invite: PartyInvite | null }): JSX.Element {
  const who = useAppStore((s) => s.who).trim()
  const [text, setText] = useState('')
  const found = invite ?? readInvite(text)
  const canPaste = typeof navigator.clipboard?.readText === 'function'
  return (
    <>
      <div className="coords-label">{invite ? 'You were invited' : 'Join a party'}</div>
      {!invite && (
        <>
          {canPaste && (
            <button
              className="btn-secondary coords-paste"
              onClick={() =>
                void navigator.clipboard
                  .readText()
                  .then(setText)
                  .catch(() => {})
              }
            >
              Paste the invite
            </button>
          )}
          <textarea
            className="coords-box"
            rows={2}
            value={text}
            placeholder={`The invite link, or ${CODE_TAG} and its code`}
            aria-label="The invite"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
        </>
      )}
      {found && (
        <div className="coords-found">
          <span>{found.name ?? 'A party'}</span>
          <small>Everyone in it sees where you are, your wind checks and what you hear or see, and you see theirs.</small>
        </div>
      )}
      {text && !found && <div className="coords-help">That is not an invite. It is a link, or {CODE_TAG} and a code.</div>}
      {found && !who && <div className="coords-help">Your initials first: they are what the party sees.</div>}
      {found && (
        <div className="coords-acts">
          <button className="btn-primary" disabled={!who} onClick={() => joinParty(found)}>
            Join
          </button>
          {invite && (
            <button className="btn-secondary" onClick={() => usePartyStore.setState({ invite: null })}>
              Not now
            </button>
          )}
        </div>
      )}
    </>
  )
}

export default function PartySheet(): JSX.Element {
  const party = usePartyStore((s) => s.party)
  const invite = usePartyStore((s) => s.invite)
  const paused = usePartyStore((s) => s.paused)
  const waiting = usePartyStore((s) => s.outbox.length)
  const syncedAt = usePartyStore((s) => s.syncedAt)
  const lastPos = usePartyStore((s) => s.lastPos)
  usePartyStore((s) => s.members)
  const who = useAppStore((s) => s.who).trim()
  const online = useAppStore((s) => s.online)
  const fix = useGpsStore((s) => s.fix)
  const locating = useGpsStore((s) => s.locating)
  const [note, setNote] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    void poll()
    const t = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const link = useMemo(() => (party ? partyLink(SHARE_BASE, party) : ''), [party])
  const qr = useMemo(() => (link ? renderSVG(link, { border: 2, whiteColor: '#ffffff', blackColor: '#101410' }) : ''), [link])

  // ---- not in a party (or invited to another one)
  if (!party || (invite && invite.id !== party.id)) {
    return (
      <div className="coords party">
        <div className="coords-help">Hunt as a party: where everyone is, their wind checks and what they hear or see, on every phone. Their scent shows in yours.</div>
        <Initials />
        {invite && party && <div className="coords-help">Joining leaves {party.name ?? 'your party'}.</div>}
        <JoinForm invite={invite} />
        {!invite && (
          <>
            <div className="coords-label">Or start one</div>
            <button className="btn-primary" disabled={!who} onClick={() => startParty()}>
              Start a party
            </button>
            {!who && <div className="coords-help">Your initials first: they are what the party sees.</div>}
          </>
        )}
        {invite && isIos && !standalone() && (
          <div className="coords-help">
            Groundwind on your home screen? It keeps its own things: open it there, then ⋯ › Party, and paste this:{' '}
            <button
              className="linklike"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(`${CODE_TAG} ${partyCode(invite)}`)
                  .then(() => setNote('Copied'))
                  .catch(() => {})
              }
            >
              Copy the code
            </button>
            {note && ` · ${note}`}
          </div>
        )}
      </div>
    )
  }

  // ---- in a party
  const members = membersList()
  const off = !paused && (!locating || !fix)
  const mine = paused ? 'not shared' : off ? (locating ? 'finding where you are…' : 'your location is off') : lastPos ? `placed ${agoLabel(Date.now() - lastPos.ts)}` : 'about to go'
  const share = () =>
    void shareOrCopy({ title: party.name ?? 'Party', text: `Join ${party.name ?? 'my party'} on Groundwind\n`, url: link }).then((r) => setNote(r === 'copied' ? 'Invite copied' : r === 'failed' ? 'Could not share' : null))
  const copyCode = () =>
    void navigator.clipboard
      ?.writeText(`${CODE_TAG} ${partyCode(party)}`)
      .then(() => setNote('Code copied'))
      .catch(() => setNote('Could not copy'))

  return (
    <div className="coords party">
      <div className="pt-head">
        <b>{party.name ?? 'Party'}</b>
        <span className="dim">{waiting ? `${waiting} to send${online ? '' : ' when there is signal'}` : syncedAt ? `up to date ${agoLabel(Date.now() - syncedAt)}` : online ? 'connecting…' : 'no signal'}</span>
      </div>

      <div className="coords-label">Who's in it</div>
      <div className="coords-list">
        <div className="coords-row pt-member pt-me">
          <span>
            <i className="pt-dot pt-dot-me" />
            <b>{who || '?'}</b> <span className="dim">you</span>
          </span>
          <span className="dim">
            {mine}
            {off && !locating && (
              <>
                {' · '}
                <button className="linklike" onClick={() => toggleLocate()}>
                  Turn it on
                </button>
              </>
            )}
          </span>
        </div>
        {members.map((m) => (
          <MemberRow key={m.mid} m={m} fixOf={fix} />
        ))}
        {!members.length && <div className="coords-help pt-alone">No one else yet. Show them the code below, or Share it.</div>}
      </div>

      <label className="pt-switch">
        <span>
          Share my position
          <small className="dim">{paused ? 'off · you are off their maps' : 'as you look at your phone'}</small>
        </span>
        <input type="checkbox" className="switch" checked={!paused} onChange={(e) => setPaused(!e.target.checked)} />
      </label>

      <div className="coords-label">Invite</div>
      <div className="pt-qr" aria-label="The invite as a QR code: scan it with the phone's camera" dangerouslySetInnerHTML={{ __html: qr }} />
      <div className="coords-help">Scan with the camera, or send it. Anyone with it can join, so send it to the party only.</div>
      <div className="coords-acts">
        <button className="btn-primary" onClick={share}>
          Share invite
        </button>
        <button className="btn-secondary" onClick={copyCode}>
          Copy code
        </button>
      </div>
      {note && <div className="coords-help">{note}</div>}

      <div className="pt-leave">
        {leaving ? (
          <>
            <span className="dim">Leave {party.name ?? 'the party'}? Their checks and sightings stay in your log.</span>
            <button className="linklike danger" onClick={() => leaveParty()}>
              Leave
            </button>
            <button className="linklike" onClick={() => setLeaving(false)}>
              Stay
            </button>
          </>
        ) : (
          <button className="linklike dim" onClick={() => setLeaving(true)}>
            Leave the party
          </button>
        )}
      </div>
    </div>
  )
}
