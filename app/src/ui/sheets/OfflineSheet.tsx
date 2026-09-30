import { useEffect, useState, type JSX } from 'react'
import { BUNDLES, DATA_FILES, REGION } from '../../config'
import { downloadFiles, fmtBytes, mapsStatus, removeFiles, useDownloads } from '../../offline/downloads'
import { listStored, storageEstimate } from '../../offline/fileStore'
import { useMapUpdates } from '../../offline/updates'
import { useAppStore } from '../../state/appStore'
import { IconCheck, IconDownload, IconTrash } from '../icons'
import './settings.css'

const LABELS = new Map(DATA_FILES.map((d) => [d.file, d.label]))
/** A baked file's name for the list: the data file's label, else the theme with the region and extension off. */
const labelOf = (name: string) =>
  LABELS.get(name) ??
  name
    .replace(`-${REGION.id}`, '')
    .replace(/\.(geojson|hab|pmtiles)$/, '')
    .replace(/[_-]/g, ' ')
    .replace(/^wmu$/, 'WMU')
    .replace(/^\w/, (c) => c.toUpperCase())

/**
 * Maps on this phone: the bundle's files, each with its size and a check
 * when it is saved, the download or the new-maps download at the top, and
 * the storage line. Reached from the Settings row; ‹ Back is the host's.
 */
export default function OfflineSheet(): JSX.Element {
  const dl = useDownloads()
  const pending = useMapUpdates((s) => s.pending)
  useAppStore((s) => s.online)
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    void storageEstimate().then(setQuota)
  }, [dl.storedAt, dl.active])

  const bundle = BUNDLES[0]
  const stored = listStored()
  const byName = new Map(stored.map((s) => [s.name, s]))
  const have = bundle.files.filter((f) => byName.has(f))
  const size = have.reduce((sum, f) => sum + (byName.get(f)?.size ?? 0), 0)
  const pendingNames = new Map(pending.map((p) => [p.name, p.why]))
  const maps = mapsStatus()

  return (
    <div className="settings">
      {dl.active && (
        <div className="st-dl">
          <div className="st-dlhead">
            <span>
              {labelOf(dl.file)} ({dl.fileIdx}/{dl.fileCount})
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
        <button className="btn-primary st-download" disabled={maps.disabled} onClick={() => void downloadFiles(maps.files, maps.replace)}>
          <IconDownload size={18} />
          {maps.text}
        </button>
      )}
      {dl.error && <div className="st-line error">{dl.error}</div>}
      {dl.skipped.length > 0 && <div className="st-line">Not built yet: {dl.skipped.map(labelOf).join(', ')}</div>}

      {bundle.files.map((f) => {
        const s = byName.get(f)
        const why = pendingNames.get(f)
        return (
          <div key={f} className={`st-file${s ? '' : ' missing'}`}>
            <span>{labelOf(f)}</span>
            {why && <span className="st-new">{why === 'new' ? 'new' : 'updated'}</span>}
            {s && <span className="numeral">{fmtBytes(s.size)}</span>}
            {s && <IconCheck size={16} />}
          </div>
        )
      })}

      <div className="st-files-foot">
        <span>
          {have.length}/{bundle.files.length} files{have.length > 0 ? ` · ${fmtBytes(size)}` : ''}
          {quota && quota.quota > 0 ? ` · ${fmtBytes(quota.usage)} used of ${fmtBytes(quota.quota)}` : ''}
        </span>
        {have.length > 0 && (
          <button
            className="icon-btn danger"
            disabled={dl.active}
            onClick={() => {
              if (confirm('Remove downloaded map data from this device?')) void removeFiles(bundle.files)
            }}
            aria-label="Remove the saved maps"
          >
            <IconTrash size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
