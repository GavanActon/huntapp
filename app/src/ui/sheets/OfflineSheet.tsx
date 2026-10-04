import { useEffect, useState, type JSX } from 'react'
import { ACTIVE_AREA, AREA_LIST, areaById, type AreaDef, type CoverageLayer } from '../../areas'
import { dataFiles, layerLabel } from '../../config'
import { downloadFiles, fmtBytes, mapsStatus, removeFiles, useDownloads } from '../../offline/downloads'
import { listStored, storageEstimate, type StoredFileInfo } from '../../offline/fileStore'
import { bundleOf, bundleOnServer, checkAreaListing, useMapUpdates } from '../../offline/updates'
import { useAppStore } from '../../state/appStore'
import { IconCheck, IconDownload, IconTrash } from '../icons'
import './settings.css'

const LABELS = new Map(AREA_LIST.flatMap(dataFiles).map((d) => [d.file, d.label]))
/** A baked file's name for the list: the data file's label, else the theme with its area and extension off. */
const labelOf = (name: string, areaId: string) =>
  LABELS.get(name) ??
  name
    .replace(`-${areaId}`, '')
    .replace(/\.(geojson|hab|pmtiles)$/, '')
    .replace(/[_-]/g, ' ')
    .replace(/^wmu$/, areaById(areaId)?.zone.label ?? 'WMU')
    .replace(/^\w/, (c) => c.toUpperCase())

/**
 * Maps on this phone, an area at a time, the one the app is in first:
 * each with its download (or its new maps) at the top, its files with a
 * size and a check when saved (another area's folded under its count),
 * its Remove, and what is in it, folded; the storage line at the foot.
 * Reached from the Settings row; ‹ Back is the host's.
 */
export default function OfflineSheet(): JSX.Element {
  const dl = useDownloads()
  // what the blocks read: re-rendered when any of it moves
  useMapUpdates((s) => s.pending)
  useMapUpdates((s) => s.onServer)
  useMapUpdates((s) => s.listing)
  useAppStore((s) => s.online)
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    void storageEstimate().then(setQuota)
  }, [dl.storedAt, dl.active])

  // what an area not saved would bring: the server's list, asked when the
  // sheet opens (in the background, only by a phone keeping another area's maps)
  useEffect(() => {
    void checkAreaListing()
  }, [])

  const stored = new Map(listStored().map((s) => [s.name, s]))
  return (
    <div className="settings">
      {AREA_LIST.map((a) => (
        <AreaMaps key={a.id} area={a} stored={stored} />
      ))}
      {quota && quota.quota > 0 && (
        <div className="st-files-foot">
          <span>
            {fmtBytes(quota.usage)} used of {fmtBytes(quota.quota)}
          </span>
        </div>
      )}
    </div>
  )
}

function AreaMaps({ area, stored }: { area: AreaDef; stored: Map<string, StoredFileInfo> }): JSX.Element | null {
  const dl = useDownloads()
  const pending = useMapUpdates((s) => s.pending)
  const listing = useMapUpdates((s) => s.listing?.[area.id])
  const here = area.id === ACTIVE_AREA.id
  // the area the app is in shows its files; another folds them under the count
  const [open, setOpen] = useState(here)
  const bundle = bundleOf(area.id)
  if (!bundle) return null
  // the files the server has baked; the rest are listed as not built yet
  const wanted = bundleOnServer(bundle.files, area.id)
  const notBuilt = bundle.files.filter((f) => !wanted.includes(f))
  const have = wanted.filter((f) => stored.has(f))
  const size = have.reduce((sum, f) => sum + (stored.get(f)?.size ?? 0), 0)
  const pendingNames = new Map(pending.filter((p) => p.area === area.id).map((p) => [p.name, p.why]))
  const maps = mapsStatus(area.id)
  // the run under way, or the last one, is this area's: its bar and its notes go here
  const ours = dl.areaId === area.id
  const label = (f: string) => labelOf(f, area.id)
  // not saved yet: what a download would bring, from the server's list of areas
  const toCome = have.length === 0 && listing?.bytes ? ` · ${fmtBytes(listing.bytes)} to download` : ''
  // a bake part way through lacks most layers: a count, not the whole list
  const unbuilt = notBuilt.length > 3 ? ` · ${notBuilt.length} not built yet` : ` · not built yet: ${notBuilt.map(label).join(', ')}`

  return (
    <>
      <div className="st-sec">
        {area.name}
        {here ? ' · this area' : ''}
      </div>
      {ours && dl.active && (
        <div className="st-dl">
          <div className="st-dlhead">
            <span>
              {label(dl.file)} ({dl.fileIdx}/{dl.fileCount})
            </span>
            <span className="numeral">
              {fmtBytes(dl.loaded)}
              {dl.total > 0 ? ` / ${fmtBytes(dl.total)}` : ''}
            </span>
          </div>
          <div className="dl-bar">
            <div className="dl-bar-fill" style={{ width: dl.total > 0 ? `${(dl.loaded / dl.total) * 100}%` : '30%' }} />
          </div>
        </div>
      )}
      {maps.action === 'download' && (
        <button className="btn-primary st-download" disabled={maps.disabled} onClick={() => void downloadFiles(maps.files, maps.replace, area.id)}>
          <IconDownload size={18} />
          {maps.text}
        </button>
      )}
      {ours && dl.error && <div className="st-line error">{dl.error}</div>}
      {ours && dl.skipped.length > 0 && <div className="st-line">Not built yet: {dl.skipped.map(label).join(', ')}</div>}

      {open &&
        wanted.map((f) => {
          const s = stored.get(f)
          const why = pendingNames.get(f)
          return (
            <div key={f} className={`st-file${s ? '' : ' missing'}`}>
              <span>{label(f)}</span>
              {why && <span className="st-new">{why === 'new' ? 'new' : 'updated'}</span>}
              {s && <span className="numeral">{fmtBytes(s.size)}</span>}
              {s && <IconCheck size={16} />}
            </div>
          )
        })}

      <div className="st-files-foot">
        <button className="st-files-count" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {have.length}/{wanted.length} files{have.length > 0 ? ` · ${fmtBytes(size)}` : toCome}
          {!open && pendingNames.size > 0 ? ` · ${pendingNames.size} new` : ''}
          {notBuilt.length > 0 && !(ours && dl.skipped.length) ? unbuilt : ''}
          <span className="dim"> {open ? '⌃' : '›'}</span>
        </button>
        {have.length > 0 && (
          <button
            className="icon-btn danger"
            disabled={dl.active}
            onClick={() => {
              if (confirm(`Remove ${area.name}'s maps from this phone?`)) void removeFiles(bundle.files, area.id)
            }}
            aria-label={`Remove ${area.name}'s saved maps`}
          >
            <IconTrash size={18} />
          </button>
        )}
      </div>
      <WhatsInIt area={area} />
    </>
  )
}

/** The kinds of layer in a coverage report, in the order they are listed. */
const KINDS = ['pmtiles', 'geo', 'baseGeo', 'grids'] as const

/**
 * What is in an area's maps, from the bake's coverage report (the area
 * file's): one line, folded. Open, each layer it has with where it came
 * from, its date and its licence, then the ones it has not and why, so a
 * layer missing in one area reads as a fact about the area, not a fault.
 */
function WhatsInIt({ area }: { area: AreaDef }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const cov = area.coverage
  if (!cov) return null
  const rows = KINDS.flatMap((kind) =>
    Object.entries(cov[kind] ?? {})
      .filter((e): e is [string, CoverageLayer] => e[1] != null && typeof e[1] === 'object')
      .map(([key, l]) => ({ id: `${kind}:${key}`, name: layerLabel(kind, key, area), l, baked: !!l.file && !l.missing })),
  )
  return (
    <>
      <div className="st-files-foot">
        <button className="st-files-count" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          What's in it<span className="dim"> {open ? '⌃' : '›'}</span>
        </button>
      </div>
      {open && (
        <ul className="st-cover">
          {[...rows.filter((r) => r.baked), ...rows.filter((r) => !r.baked)].map(({ id, name, l, baked }) => (
            <li key={id} className={baked ? undefined : 'missing'}>
              <span>{name}</span>
              {baked ? <Facts l={l} /> : <small>{l.missing ?? 'not baked yet'}</small>}
            </li>
          ))}
          {cov.checked && <li className="st-cover-foot">Checked {cov.checked}</li>}
        </ul>
      )}
    </>
  )
}

/** A layer's source, date and licence, the licence on one line (OGL-Ontario
 *  broken at its hyphen read as two things). */
function Facts({ l }: { l: CoverageLayer }): JSX.Element {
  const head = [l.source, l.vintage].filter(Boolean).join(' · ')
  return (
    <small>
      {head}
      {l.licence && (
        <>
          {head ? ' · ' : ''}
          <span className="st-nb">{l.licence}</span>
        </>
      )}
      {l.note ? `${head || l.licence ? ' · ' : ''}${l.note}` : ''}
    </small>
  )
}
