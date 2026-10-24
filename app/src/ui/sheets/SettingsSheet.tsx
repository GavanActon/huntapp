import { useEffect, useMemo, useState, type JSX } from 'react'
import { useSession } from '../../account/session'
import { ACTIVE_AREA } from '../../areas'
import { hasSdWind, SD_PREVIEW } from '../../config'
import { setStatsOn, statsId, statsOn } from '../../analytics'
import { getMap } from '../../map/mapController'
import { clearDevlog, devlogCount, devlogOn, lastUpload, onDevlog, setDevlog, shareDevlog, uploadDevlog, uploadSettings } from '../../devlog'
import { BUILD } from '../../diagnostics'
import { checkAppUpdate, reloadApp, useAppUpdate } from '../../offline/appUpdate'
import { mapsStatus, runMaps, useDownloads } from '../../offline/downloads'
import { checkMapUpdates, useMapUpdates } from '../../offline/updates'
import { useAppStore } from '../../state/appStore'
import { setTerrainWind, terrainWind, type TerrainWind } from '../../state/terrainWind'
import { flushTrackSave } from '../../tracking/trackStore'
import { agoLabel, dayTimeLabel } from '../../time'
import { campForecast, hrdpsRunLabel, nextWeatherUpdateMs, onWeatherRefreshed, refreshWeather, useWeatherStatus } from '../../weather/refresh'
import { onShareChange, setShare, shareCounts, shareState } from '../../weather/micro/checkShare'
import { carryPlaced } from '../../weather/micro/scent'
import './settings.css'

/**
 * The terrain wind, HD or SD (state/terrainWind.ts): the ground model reads
 * one file a run, so a switch reloads the app. The people placed for the
 * scent are carried over it, as for new maps (offline/downloads.ts), and
 * the walk being recorded is written first: placing a setup and flipping
 * between the two is the point of having both.
 */
function pickTerrainWind(v: TerrainWind): void {
  if (v === terrainWind()) return
  carryPlaced()
  flushTrackSave()
  setTerrainWind(v)
  window.location.reload()
}

const TEXT_SIZES = [
  ['auto', 'Auto'],
  ['standard', 'A'],
  ['large', 'A+'],
  ['larger', 'A++'],
] as const

/**
 * The build on the phone against the one on the server (offline/appUpdate.ts):
 * Check now asks, Reload runs a new one once the worker has it.
 */
function BuildRow({ online }: { online: boolean }): JSX.Element {
  const up = useAppUpdate()
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])
  const when = new Date(BUILD.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  let line: string
  if (up.ready) line = 'A new build is on the phone: reload to run it'
  else if (up.checking) line = 'Checking…'
  else if (up.latest) line = `Newer on the server (${up.latest}), fetching it…`
  else if (up.checkedAt) line = `Up to date · checked ${agoLabel(Date.now() - up.checkedAt)}`
  else line = online ? 'Not checked yet' : 'Checks when there is signal'
  return (
    <div className="st-row st-two">
      <span>
        <span>
          Build <span className="numeral">{BUILD.sha}</span> <span className="dim">· {when}</span>
        </span>
        <small className="dim">{line}</small>
      </span>
      {up.ready ? (
        <button className="st-more" onClick={reloadApp}>
          Reload
        </button>
      ) : (
        <button className="st-more" disabled={up.checking || !online} onClick={() => void checkAppUpdate(true)}>
          Check now
        </button>
      )}
    </div>
  )
}

/**
 * The weather on the phone: when it was last brought in, when the next
 * model run lands (the moment the app fetches again by itself, given
 * signal), and a Refresh for when the signal is here now. Brief: the
 * forecast itself is the strip's.
 */
function WeatherRow({ online }: { online: boolean }): JSX.Element {
  const st = useWeatherStatus()
  const [, setTick] = useState(0)
  // the ages move: once a minute, and the moment a sweep brings something in
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    const off = onWeatherRefreshed(() => setTick((n) => n + 1))
    return () => {
      window.clearInterval(t)
      off()
    }
  }, [])

  const f = campForecast()
  const now = Date.now()
  let line: string
  if (st.busy) line = 'Updating…'
  else if (!f) line = online ? 'No outlook yet · fetching' : 'No outlook yet · fetches when there is signal'
  else {
    const next = nextWeatherUpdateMs() ?? now
    const run = f.hrdpsHours ? `HRDPS ${hrdpsRunLabel(f.fetchedAt)}` : 'blend'
    const when = next <= now ? (online ? 'a newer run is in' : 'a newer run is in · fetches when there is signal') : `next run lands ~${dayTimeLabel(next)}`
    line = `Updated ${agoLabel(now - f.fetchedAt)} · ${run} · ${when}`
    if (st.lastFailAt && st.lastFailAt > f.fetchedAt) line += ` · last try failed ${agoLabel(now - st.lastFailAt)}`
  }

  return (
    <div className="st-row st-two">
      <span>
        Weather
        <small className={st.lastError && st.lastFailAt && (!f || st.lastFailAt > f.fetchedAt) ? 'warn' : 'dim'}>{line}</small>
      </span>
      <button className="st-more" disabled={st.busy || !online} onClick={() => void refreshWeather('settings', true)}>
        {st.busy ? 'Updating…' : 'Refresh'}
      </button>
    </div>
  )
}

/** Every credit the map's sources carry, once each, as plain words. */
function mapCredits(): string[] {
  const style = getMap()?.getStyle()
  const out: string[] = []
  for (const src of Object.values(style?.sources ?? {})) {
    const a = (src as { attribution?: string }).attribution
    if (!a) continue
    for (const part of a.split('|')) {
      const t = part.replace(/<[^>]+>/g, '').trim()
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out
}

/**
 * Usage stats (analytics.ts): on unless switched off here. The phone's id
 * shows while on, so your own taps can be told from everyone's.
 */
function StatsRow(): JSX.Element {
  const [on, setOn] = useState(statsOn)
  return (
    <label className="st-row st-two">
      <span>
        Usage stats
        <small className="dim">{on ? `what's tapped and for how long, never where you are · phone ${statsId().slice(0, 8)}` : 'off · nothing is kept or sent'}</small>
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={on}
        onChange={(e) => {
          setStatsOn(e.target.checked)
          setOn(e.target.checked)
        }}
      />
    </label>
  )
}

/**
 * Sharing the wind checks (weather/micro/checkShare.ts): on unless this
 * phone said no, switched here. While on, how many have gone and how many
 * wait for a signal.
 */
function CheckShareRow({ online }: { online: boolean }): JSX.Element {
  const [, tick] = useState(0)
  useEffect(() => onShareChange(() => tick((n) => n + 1)), [])
  const on = shareState() === 'on'
  const { sent, waiting } = shareCounts()
  const status = !on
    ? 'off · your checks stay on this phone'
    : waiting
      ? `${sent} sent · ${waiting} to go${online ? '' : ' when there is signal'}`
      : `all ${sent} sent · without your name or notes`
  return (
    <label className="st-row st-two">
      <span>
        Share wind checks
        <small className="dim">{status}</small>
      </span>
      <input type="checkbox" className="switch" checked={on} onChange={(e) => setShare(e.target.checked ? 'on' : 'off', 'settings')} />
    </label>
  )
}

/**
 * The dev log: off for everyone until switched on here; then a count of
 * what it holds and the ways out — Upload for a code and a link (the
 * Sandies API keeps it a month), Share as a file, Copy link, Clear.
 */
function DevlogRows(): JSX.Element {
  const [, tick] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => onDevlog(() => tick((n) => n + 1)), [])
  const on = devlogOn()
  const last = lastUpload()

  const upload = async () => {
    setBusy(true)
    setNote(null)
    try {
      const u = await uploadDevlog()
      setNote(`Uploaded · code ${u.code}`)
    } catch (e) {
      setNote(`Upload failed · ${e instanceof Error ? e.message : 'no answer'}`)
    } finally {
      setBusy(false)
    }
  }
  const share = async () => {
    const r = await shareDevlog()
    setNote(r === 'shared' ? 'Shared' : r === 'copied' ? 'Copied' : 'Could not share')
  }
  const copyLink = async () => {
    if (!last) return
    try {
      await navigator.clipboard.writeText(last.url)
      setNote('Link copied')
    } catch {
      setNote(last.url)
    }
  }

  return (
    <>
      <label className="st-row st-devlog">
        <span>
          Dev log
          <small className="dim">{on ? `${devlogCount()} lines · boots, freezes, sheets, errors, what the modules say` : 'what the app is doing, for a bug that leaves no trace · includes your position'}</small>
        </span>
        <input type="checkbox" className="switch" checked={on} onChange={(e) => setDevlog(e.target.checked)} />
      </label>
      {on && (
        <div className="st-acts">
          <button className="btn-primary" disabled={busy} onClick={() => void upload()}>
            {busy ? 'Uploading…' : 'Upload log'}
          </button>
          <button className="st-more" onClick={() => void share()}>
            Share
          </button>
          {last && (
            <button className="st-more" onClick={() => void copyLink()}>
              Link · {last.code}
            </button>
          )}
          <button className="st-more dim" onClick={() => clearDevlog()}>
            Clear
          </button>
          {note && <span className="st-note dim">{note}</span>}
        </div>
      )}
    </>
  )
}

/** Dev mode: a tap on the map is where you are (gpsService setTapFix), for trying the out-there parts at home. */
function GpsTapRow(): JSX.Element {
  const on = useAppStore((s) => s.devGpsTap)
  return (
    <label className="st-row st-two">
      <span>
        GPS on tap
        <small className="dim">a tap on the map puts you there; the phone's GPS is let go till this is off</small>
      </span>
      <input type="checkbox" className="switch" checked={on} onChange={(e) => useAppStore.getState().setDevGpsTap(e.target.checked)} />
    </label>
  )
}

/** My settings › Send: the settings alone, no log and no position, for a
 *  phone set up just so to become the app's defaults (devlog.ts). The
 *  answer is a code to read out. */
function SendSettingsRow({ online }: { online: boolean }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const send = async () => {
    setBusy(true)
    setNote(null)
    try {
      setNote(`Sent · code ${await uploadSettings()}`)
    } catch (e) {
      setNote(`Not sent · ${e instanceof Error ? e.message : 'no answer'}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="st-row st-two">
      <span>
        <span>My settings</span>
        <small className="dim">{note ?? 'settings only: no log, position, pins or tracks'}</small>
      </span>
      <button className="st-more" disabled={busy || !online} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}

/**
 * Settings, one level deep, under headings and nothing folded away (Gavan,
 * 2026-10-05: categorical, but don't hide): On this phone (the maps, the
 * weather), Map (Map buttons and Views, which left the ⋯ menu for here, past
 * hunts), Display (units, the hand, text and buttons; Outdoor is the strip's
 * own button), Sharing (your initials, the checks, the stats), About (the
 * credits, the build), and Dev mode, a switch that shows the rows for
 * building the app: the terrain wind's HD/SD, the wind's particles and trail
 * (out of the Wind flow button's drawer), the scent knobs, sending these
 * settings, the dev log (Gavan, 2026-10-17). The download runs in
 * offline/downloads.ts, so closing the sheet does not stop it. The host draws
 * the title row.
 */
export default function SettingsSheet(): JSX.Element {
  const units = useAppStore((s) => s.units)
  const setUnits = useAppStore((s) => s.setUnits)
  // signed in or not (account/session.ts): the row says whose, or Sign in
  const account = useSession((s) => s.email)
  const textSize = useAppStore((s) => s.textSize)
  const stripButtons = useAppStore((s) => s.stripButtons)
  const setStripButtons = useAppStore((s) => s.setStripButtons)
  const devMode = useAppStore((s) => s.devMode)
  const setDevMode = useAppStore((s) => s.setDevMode)
  const density = useAppStore((s) => s.flowTuning.windDensity)
  const trail = useAppStore((s) => s.flowTuning.windTrail)
  const setFlowTuning = useAppStore((s) => s.setFlowTuning)
  const setTextSize = useAppStore((s) => s.setTextSize)
  const buttonLabels = useAppStore((s) => s.buttonLabels)
  const setButtonLabels = useAppStore((s) => s.setButtonLabels)
  const pastHunts = useAppStore((s) => s.pastHunts)
  const setPastHunts = useAppStore((s) => s.setPastHunts)
  // the one in use this run: a switch reloads the app
  const terrain = terrainWind()
  const who = useAppStore((s) => s.who)
  const setWho = useAppStore((s) => s.setWho)
  const pushSheet = useAppStore((s) => s.pushSheet)
  // what the Maps and Weather rows read: re-rendered when any of it moves
  const online = useAppStore((s) => s.online)
  useMapUpdates((s) => s.pending)
  const dl = useDownloads()

  // opening Settings is a good moment to ask the server again
  useEffect(() => {
    void checkMapUpdates()
  }, [])

  const maps = mapsStatus()
  const credits = useMemo(mapCredits, [])

  return (
    <div className="settings">
      <div className="st-sec">On this phone</div>
      {/* the row's word (All saved, Download) is the area the app is in; the sheet has every area */}
      {/* the whole row opens the maps sheet, with its › (Gavan, 2026-10-19: "Maps on this phone not a button");
          Download stays its own button */}
      <div className="st-row st-two">
        <button onClick={() => pushSheet({ kind: 'offline' })}>
          <span>Maps on this phone</span>
          <small>{ACTIVE_AREA.name}</small>
        </button>
        {maps.action === 'download' ? (
          <button className="st-more" disabled={maps.disabled} onClick={() => void runMaps(maps)}>
            {maps.text}
          </button>
        ) : (
          <button className="st-go" onClick={() => pushSheet({ kind: 'offline' })}>
            <span className={dl.active ? 'st-more' : 'dim'}>{maps.text}</span> <span className="dim">›</span>
          </button>
        )}
      </div>
      {dl.active && (
        <div className="st-dl">
          <div className="dl-bar">
            <div className="dl-bar-fill" style={{ width: dl.total > 0 ? `${(dl.loaded / dl.total) * 100}%` : '30%' }} />
          </div>
        </div>
      )}
      <WeatherRow online={online} />
      <button className="st-row st-two" onClick={() => pushSheet({ kind: 'account' })}>
        <span>
          Your account
          <small>{account ?? 'your spots on every phone, and HD'}</small>
        </span>
        <span className="dim">{account ? '›' : 'Sign in ›'}</span>
      </button>

      <div className="st-sec">Map</div>
      <button className="st-row" onClick={() => pushSheet({ kind: 'buttons' })}>
        <span>Map buttons</span>
        <span className="dim">›</span>
      </button>
      <button className="st-row" onClick={() => pushSheet({ kind: 'views' })}>
        <span>Views</span>
        <span className="dim">›</span>
      </button>
      {/* the contour interval and the wind's knobs are the Contours and Wind flow buttons' own (a press and hold, HotDrawer), not here as well; the wind's particles and trail are under Dev mode */}
      <div className="st-row">
        <span>Past hunts on the map</span>
        <div className="seg" role="radiogroup" aria-label="Past hunts on the map">
          {(['none', 'today', 'week', 'all'] as const).map((v) => (
            <button key={v} className={pastHunts === v ? 'seg-on' : ''} role="radio" aria-checked={pastHunts === v} onClick={() => setPastHunts(v)}>
              {v === 'none' ? 'None' : v === 'today' ? 'Today' : v === 'week' ? '7 days' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="st-sec">Display</div>
      <div className="st-row">
        <span>Units</span>
        <div className="seg" role="radiogroup" aria-label="Units">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} className={units === u ? 'seg-on' : ''} role="radio" aria-checked={units === u} onClick={() => setUnits(u)}>
              {u === 'metric' ? '°C km/h' : '°F mph'}
            </button>
          ))}
        </div>
      </div>
      {/* the thumb's side is Map buttons' Flip now (2026-10-19) */}
      <label className="st-row">
        <span>Button names</span>
        <input type="checkbox" className="switch" checked={buttonLabels} onChange={(e) => setButtonLabels(e.target.checked)} />
      </label>
      <div className="st-row">
        <span>Text size</span>
        <div className="seg" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map(([t, label]) => (
            <button key={t} className={textSize === t ? 'seg-on' : ''} role="radio" aria-checked={textSize === t} onClick={() => setTextSize(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="st-row">
        <span>Top row buttons</span>
        <div className="seg" role="radiogroup" aria-label="Top row buttons">
          {([['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']] as const).map(([t, label]) => (
            <button key={t} className={stripButtons === t ? 'seg-on' : ''} role="radio" aria-checked={stripButtons === t} onClick={() => setStripButtons(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Outdoor (for sun on the phone) is the strip's own button, not a row here as well */}

      <div className="st-sec">Sharing</div>
      <label className="st-row">
        <span>
          Your initials <span className="dim">· on the wind checks you share with your party</span>
        </span>
        <input type="text" className="st-text" value={who} maxLength={12} placeholder="GA" onChange={(e) => setWho(e.target.value)} aria-label="Your initials" />
      </label>
      <CheckShareRow online={online} />
      <StatsRow />

      <div className="st-sec">About</div>
      <details className="st-credits">
        <summary className="st-row">
          <span>Map credits</span>
          <span className="dim">›</span>
        </summary>
        <ul>
          {credits.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>© MapLibre</li>
        </ul>
      </details>
      <BuildRow online={online} />

      {/* the rows for building the app, behind one switch (Gavan, 2026-10-17) */}
      <div className="st-sec">Dev mode</div>
      <label className="st-row st-two">
        <span>
          Dev mode
          <small className="dim">the rows for building the app: the terrain wind, the wind's particles and trail, the scent knobs, sending these settings, the dev log</small>
        </span>
        <input type="checkbox" className="switch" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} />
      </label>
      {devMode && (
        <>
          {/* shown as SD (the pill's grade word), the wind is SD's whatever this says */}
          {hasSdWind() && !SD_PREVIEW && (
            <div className="st-row st-two">
              <span>
                Terrain wind
                <small className="dim">HD is WindNinja's solve baked for this area. SD is the net that stands in for it where no solve has run.</small>
              </span>
              <div className="seg" role="radiogroup" aria-label="Terrain wind">
                {(['hd', 'sd'] as const).map((v) => (
                  <button key={v} className={terrain === v ? 'seg-on' : ''} role="radio" aria-checked={terrain === v} onClick={() => pickTerrainWind(v)}>
                    {v === 'hd' ? 'HD' : 'SD'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* out of the Wind flow button's drawer (Gavan, 2026-10-17: "stuff you probably don't want") */}
          <div className="st-row st-slider">
            <span>
              Wind particles <span className="numeral">· {density}</span>
            </span>
            <input type="range" min={200} max={2500} step={100} value={density} onChange={(e) => setFlowTuning({ windDensity: Number(e.target.value) })} aria-label="Wind particles" />
          </div>
          <div className="st-row st-slider">
            <span>
              Wind trail <span className="numeral">· {trail.toFixed(2)}</span>
            </span>
            <input type="range" min={86} max={97} step={1} value={Math.round(trail * 100)} onChange={(e) => setFlowTuning({ windTrail: Number(e.target.value) / 100 })} aria-label="Wind trail" />
          </div>
          <button className="st-row st-two" onClick={() => useAppStore.getState().openSheet({ kind: 'scentTune' })}>
            <span>
              Scent tuning
              <small className="dim">the cone's knobs on sliders, kept on this phone</small>
            </span>
            <span className="dim">›</span>
          </button>
          <GpsTapRow />
          <SendSettingsRow online={online} />
          <DevlogRows />
        </>
      )}
    </div>
  )
}
