import { useState, type JSX } from 'react'
import { SAT_NUMBER } from '../../config'
import { useAppStore } from '../../state/appStore'
import { agoLabel, clockShort } from '../../time'
import { refreshWeather, campForecast, hrdpsRunLabel } from '../../weather/refresh'
import { applySatText, markAsked, runLabel, satAsk, windWords, type SatAsk, type SatResult } from '../../weather/satForecast'
import '../areas.css'
import '../sat.css'

/**
 * Weather by satellite (weather/satForecast.ts, docs/SAT-FORECAST.md): no
 * signal, and the newest forecast by text. Two steps on one sheet. Send:
 * the request the app wrote, with Text it (an iPhone on satellite opens
 * Messages with it filled in) and Copy (for an inReach's Messenger). Paste:
 * the answer, the whole message as it came; a paste is the update, with no
 * button after it. The request is remembered, so the sheet opened again
 * minutes later says when it was asked.
 */

/** +18075550100 as a person reads it: +1 807 555 0100. */
function prettyNumber(n: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n)
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : n
}

export default function SatSheet(): JSX.Element {
  const units = useAppStore((s) => s.units)
  const online = useAppStore((s) => s.online)
  const [ask, setAsk] = useState<SatAsk>(satAsk)
  const [text, setText] = useState('')
  const [result, setResult] = useState<SatResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const f = campForecast()
  const canPaste = typeof navigator.clipboard?.readText === 'function'
  const now = Date.now()

  const sent = () => setAsk(markAsked(ask))

  const copy = (what: string, done: string) => {
    if (typeof navigator.clipboard?.writeText !== 'function') return setNote('Could not copy')
    void navigator.clipboard.writeText(what).then(
      () => setNote(done),
      () => setNote('Could not copy'),
    )
  }

  /** A reply in the box is taken in at once: the paste is the update. */
  const take = (t: string) => {
    setText(t)
    setNote(null)
    setResult(t.trim() ? applySatText(t) : null)
  }

  const paste = () => {
    // read inside the tap: iOS puts its own Paste bubble by the finger
    let read: Promise<string>
    try {
      read = navigator.clipboard.readText()
    } catch {
      read = Promise.reject(new Error('no clipboard'))
    }
    void read.then(take, () => setNote('Could not read the clipboard. Paste into the box.'))
  }

  const refresh = () => {
    setRefreshing(true)
    void refreshWeather('sat sheet', true).finally(() => setRefreshing(false))
  }

  // what the phone has now: the run its newest hours are from, and how old
  const had = f ? (f.sat ? `HRDPS ${runLabel(f.sat.runMs)} by satellite, ${agoLabel(now - f.sat.at)}` : `${f.hrdpsHours ? `HRDPS ${hrdpsRunLabel(f.fetchedAt)}` : 'Forecast'}, fetched ${agoLabel(now - f.fetchedAt)}`) : 'No forecast on the phone yet'

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

      <div className="coords-label">1 · Send this</div>
      <div className="sat-req numeral">{ask.text}</div>
      <div className="coords-acts">
        {SAT_NUMBER && (
          <a className="btn-primary" href={`sms:${SAT_NUMBER}?&body=${encodeURIComponent(ask.text)}`} onClick={sent}>
            Text it
          </a>
        )}
        <button
          className={SAT_NUMBER ? 'btn-secondary' : 'btn-primary'}
          onClick={() => {
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
          <button className="linklike" onClick={() => copy(SAT_NUMBER, 'Number copied')}>
            Copy number
          </button>
          <br />
          iPhone on satellite: Text it, then Send. inReach: a new message in Messenger to the number, paste, send.
        </div>
      ) : (
        <div className="coords-help">The Groundwind number is not set up yet. A reply made another way can still be pasted below.</div>
      )}

      <div className="coords-label">2 · Paste the answer</div>
      {ask.askedAt && !result?.ok && <div className="coords-help">Asked {agoLabel(now - ask.askedAt)}. An answer takes a few minutes; on an inReach, check for messages.</div>}
      {canPaste && (
        <button className="btn-secondary coords-paste" onClick={paste}>
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
        onChange={(e) => take(e.target.value)}
      />
      {note && <div className="coords-help">{note}</div>}
      {result && !result.ok && <div className="coords-help sat-bad">{result.why}</div>}
      {result?.ok && (
        <div className="coords-found sat-ok">
          <span>Weather updated</span>
          <small>
            HRDPS {runLabel(result.runMs)} · {result.hours} h
          </small>
          {result.change && (
            <small>
              At dusk ({clockShort(result.change.atMs)}): {windWords(result.change.now, units)}
              {result.change.was && `, was ${windWords(result.change.was, units)}`}
            </small>
          )}
        </div>
      )}
    </div>
  )
}
