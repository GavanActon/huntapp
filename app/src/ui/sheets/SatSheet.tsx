import { useEffect, useState, type JSX } from 'react'
import { SAT_NUMBER } from '../../config'
import { track } from '../../analytics'
import { useAppStore } from '../../state/appStore'
import { agoLabel, clockShort } from '../../time'
import { refreshWeather, campForecast, hrdpsRunLabel } from '../../weather/refresh'
import { applySatText, markAsked, runLabel, SAT_WAIT_MS, satAsk, windWords, type SatAsk, type SatResult } from '../../weather/satForecast'
import '../areas.css'
import '../sat.css'

/**
 * Weather by satellite (weather/satForecast.ts, docs/SAT-FORECAST.md): no
 * signal, and the newest forecast by text. One step at a time, so it is
 * plain where you are (Gavan, 2026-10-14: the paste worked and the sheet
 * still looked unfinished, its "Weather updated" under the box).
 * Send: the request the app wrote, with Text it (an iPhone on satellite
 * opens Messages with it filled in) and Copy (for an inReach's Messenger).
 * Paste: once sent, the request folds to "Sent 2 min ago · Send again" and
 * Paste is the big button; a paste is the update, with no button after it.
 * Updated: the sheet becomes the answer, with Done back to the map and its
 * new streaks. The request is remembered, so the sheet opened again within
 * SAT_WAIT_MS opens on the paste; a tap that only opened Messages is not
 * proof it went, hence Send again. A reply got some other way can be
 * pasted without sending.
 * Each step is a `sat` event (docs/ANALYTICS.md), so the stats can say how
 * far people get: opened, sent, pasted, updated, Done.
 */

/** +18075550100 as a person reads it: +1 807 555 0100. */
function prettyNumber(n: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n)
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : n
}

let pasteTimer = 0

/**
 * How to get the reply out of Messages, drawn: hold it, tap Copy, come back
 * and tap Paste (Gavan, 2026-10-19: "need more affordance when texting ...
 * provide an image in the app showcasing exactly what to do"). Drawn in
 * the sheet's own colours, not a screenshot, so it reads the same in the
 * dark and outdoor looks. The reply itself has no room for the words: it
 * is one 160-character text, and every character spent on them is a
 * forecast hour or more not sent (docs/SAT-FORECAST.md).
 */
function HowToCopy(): JSX.Element {
  return (
    <div className="sat-how" role="img" aria-label="Press and hold the reply, tap Copy, then come back here and tap Paste">
      <div className="sat-how-step">
        <div className="sat-how-pic">
          <div className="sat-bubble">NW 11g40, calm by 9p GW1.cy3pKme2UAnx…</div>
          <span className="sat-press" />
        </div>
        <span>
          <b>1</b> Hold the reply
        </span>
      </div>
      <div className="sat-how-step">
        <div className="sat-how-pic">
          <div className="sat-menu">
            <span>Reply</span>
            <span className="on">Copy</span>
            <span>More…</span>
          </div>
        </div>
        <span>
          <b>2</b> Tap Copy
        </span>
      </div>
      <div className="sat-how-step">
        <div className="sat-how-pic">
          <div className="sat-pastebtn">Paste</div>
          <span className="sat-press sat-press-btn" />
        </div>
        <span>
          <b>3</b> Back here, Paste
        </span>
      </div>
    </div>
  )
}

export default function SatSheet(): JSX.Element {
  const units = useAppStore((s) => s.units)
  const online = useAppStore((s) => s.online)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const [ask, setAsk] = useState<SatAsk>(satAsk)
  const [text, setText] = useState('')
  const [result, setResult] = useState<SatResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  /** 'auto' follows the request; Send again and "Already have a reply?" pick a step by hand */
  const [view, setView] = useState<'auto' | 'ask' | 'paste'>('auto')
  const f = campForecast()
  const canPaste = typeof navigator.clipboard?.readText === 'function'
  const now = Date.now()
  const waiting = ask.askedAt != null && now - ask.askedAt < SAT_WAIT_MS
  const step = view === 'auto' ? (waiting ? 'paste' : 'ask') : view

  // the sheet opened on the paste: a request was out from this phone
  useEffect(() => {
    const a = satAsk()
    track('sat', { step: 'open', on: a.askedAt != null && Date.now() - a.askedAt < SAT_WAIT_MS ? 'paste' : 'send' })
  }, [])

  const sent = () => {
    setAsk(markAsked(ask))
    setView('auto')
  }
  // counted in the tap itself: Text it hands the phone to Messages at once
  const tell = (how: 'text' | 'copy') => track('sat', { step: 'send', how, again: waiting })
  // Text it is a link to Messages: step on after the tap has opened it,
  // not while the link is still being followed
  const sentLater = () => window.setTimeout(sent, 250)

  const copy = (what: string, done: string) => {
    if (typeof navigator.clipboard?.writeText !== 'function') return setNote('Could not copy')
    void navigator.clipboard.writeText(what).then(
      () => setNote(done),
      () => setNote('Could not copy'),
    )
  }

  /** A reply in the box is taken in at once: the paste is the update. */
  const take = (t: string, via: 'button' | 'box') => {
    setText(t)
    setNote(null)
    const r = t.trim() ? applySatText(t) : null
    setResult(r)
    // a paste is one change, typing is many: the box as it came to rest
    window.clearTimeout(pasteTimer)
    if (r) pasteTimer = window.setTimeout(() => track('sat_paste', r.ok ? { ok: true, hours: r.hours, changed: !!r.change, via } : { ok: false, why: r.why.split(/[.:]/)[0], via }), 1500)
  }

  const paste = () => {
    // read inside the tap: iOS puts its own Paste bubble by the finger
    let read: Promise<string>
    try {
      read = navigator.clipboard.readText()
    } catch {
      read = Promise.reject(new Error('no clipboard'))
    }
    void read.then(
      (t) => take(t, 'button'),
      () => {
        track('sat', { step: 'clip_fail' })
        setNote('Could not read the clipboard. Paste into the box.')
      },
    )
  }

  const refresh = () => {
    track('sat', { step: 'refresh' })
    setRefreshing(true)
    void refreshWeather('sat sheet', true).finally(() => setRefreshing(false))
  }

  // what the phone has now: the run its newest hours are from, and how old
  const had = f ? (f.sat ? `HRDPS ${runLabel(f.sat.runMs)} by satellite, ${agoLabel(now - f.sat.at)}` : `${f.hrdpsHours ? `HRDPS ${hrdpsRunLabel(f.fetchedAt)}` : 'Forecast'}, fetched ${agoLabel(now - f.fetchedAt)}`) : 'No forecast on the phone yet'

  if (result?.ok) {
    return (
      <div className="coords sat">
        <div className="sat-done">
          <strong>Weather updated</strong>
          <span>
            HRDPS {runLabel(result.runMs)} · {result.hours} h
          </span>
          {result.change && (
            <span>
              At dusk ({clockShort(result.change.atMs)}): {windWords(result.change.now, units)}
              {result.change.was && `, was ${windWords(result.change.was, units)}`}
            </span>
          )}
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            track('sat', { step: 'done' })
            closeSheet()
          }}
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="coords sat">
      <div className="coords-help">{had}</div>
      {online && (
        <div className="sat-online">
          <span>There is signal: no text needed.</span>
          <button className="linklike" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      )}

      {step === 'ask' ? (
        <>
          <div className="coords-label">1 · Send this</div>
          <div className="sat-req numeral">{ask.text}</div>
          <div className="coords-acts">
            {SAT_NUMBER && (
              <a
                className="btn-primary"
                href={`sms:${SAT_NUMBER}?&body=${encodeURIComponent(ask.text)}`}
                onClick={() => {
                  tell('text')
                  sentLater()
                }}
              >
                Text it
              </a>
            )}
            <button
              className={SAT_NUMBER ? 'btn-secondary' : 'btn-primary'}
              onClick={() => {
                tell('copy')
                sent()
                copy(ask.text, 'Copied. Paste it into a message to the number.')
              }}
            >
              Copy
            </button>
          </div>
          {SAT_NUMBER ? (
            <div className="coords-help">
              To <span className="numeral">{prettyNumber(SAT_NUMBER)}</span>{' '}
              <button
                className="linklike"
                onClick={() => {
                  track('sat', { step: 'copy_number' })
                  copy(SAT_NUMBER, 'Number copied')
                }}
              >
                Copy number
              </button>
              <br />
              iPhone on satellite: Text it, then Send. inReach: a new message in Messenger to the number, paste, send.
            </div>
          ) : (
            <div className="coords-help">The Groundwind number is not set up yet.</div>
          )}
          {note && <div className="coords-help">{note}</div>}
          <div className="sat-step">
            <button
              className="linklike"
              onClick={() => {
                track('sat', { step: 'have_reply' })
                setView('paste')
              }}
            >
              Already have a reply? Paste it
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sat-step">
            <span>{waiting && ask.askedAt != null ? `Sent ${agoLabel(now - ask.askedAt)}` : 'Nothing sent from this phone'}</span>
            <button
              className="linklike"
              onClick={() => {
                track('sat', { step: 'again', waiting })
                setView('ask')
              }}
            >
              {waiting ? 'Send again' : 'Send a request'}
            </button>
          </div>

          <div className="coords-label">2 · Paste the answer</div>
          {waiting && <div className="coords-help">An answer takes a few minutes; on an inReach, check for messages.</div>}
          <HowToCopy />
          <div className="coords-help">The whole message, in Messages on an iPhone, or the Garmin Messenger app for an inReach.</div>
          {canPaste && (
            <button className="btn-primary coords-paste" onClick={paste}>
              Paste
            </button>
          )}
          <textarea
            className="coords-box sat-box"
            rows={3}
            value={text}
            placeholder="The whole reply, as it came"
            aria-label="The reply"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => take(e.target.value, 'box')}
          />
          {note && <div className="coords-help">{note}</div>}
          {result && !result.ok && <div className="coords-help sat-bad">{result.why}</div>}
        </>
      )}
    </div>
  )
}
