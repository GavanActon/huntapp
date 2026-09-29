import { useEffect, useState } from 'react'
import { BUNDLES, DATA_BASE } from '../../config'
import {
  deleteStoredFile,
  downloadToStore,
  listStored,
  requestPersistence,
  storageEstimate,
} from '../../offline/fileStore'
import { checkMapUpdates, serverHashes, useMapUpdates } from '../../offline/updates'
import { useAppStore } from '../../state/appStore'
import { IconCheck, IconDownload, IconTrash } from '../icons'

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  return `${(n / 1e3).toFixed(0)} KB`
}

interface DlState {
  active: boolean
  file: string
  loaded: number
  total: number
  fileIdx: number
  fileCount: number
}

/** Download the region's baked map data (PMTiles) to the phone. Files the
 *  pipeline has not produced yet are skipped with a note rather than an
 *  error, so a partial build is still downloadable. */
export default function OfflinePanel() {
  const online = useAppStore((s) => s.online)
  const [stored, setStored] = useState(listStored())
  const [dl, setDl] = useState<DlState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)
  const pending = useMapUpdates((s) => s.pending)

  // opening the section is a good moment to ask the server again
  useEffect(() => {
    void checkMapUpdates()
  }, [])

  useEffect(() => {
    void storageEstimate().then(setQuota)
  }, [stored, dl])

  const storedNames = new Set(stored.map((s) => s.name))

  /** Download the files not on the phone, or with `replace` these files whether or not they are. */
  async function downloadBundle(files: string[], replace = false) {
    setError(null)
    setSkipped([])
    // OPFS and Cache Storage only exist on https (or localhost): over plain
    // http on the LAN the download has nowhere to write
    if (!window.isSecureContext) {
      setError('Downloads need a secure page. Open the app over https (the dev server started with dev:phone) or from the published site.')
      return
    }
    await requestPersistence()
    const todo = replace ? files : files.filter((f) => !storedNames.has(f))
    const hashes = await serverHashes()
    const missing: string[] = []
    try {
      for (let i = 0; i < todo.length; i++) {
        const file = todo[i]
        const head = await fetch(DATA_BASE + file, { method: 'HEAD' }).catch(() => null)
        if (!head || !head.ok) {
          missing.push(file)
          continue
        }
        await downloadToStore(
          DATA_BASE + file,
          file,
          (loaded, total) => setDl({ active: true, file, loaded, total, fileIdx: i + 1, fileCount: todo.length }),
          undefined,
          hashes.get(file),
        )
        setStored(listStored())
      }
      setDl(null)
      setSkipped(missing)
      if (missing.length < todo.length) window.location.reload()
    } catch (e) {
      setDl(null)
      const why = e instanceof Error && e.message ? ` (${e.message})` : ''
      setError(`Download failed. Check the connection and try again${why}.`)
      setStored(listStored())
    }
  }

  async function removeBundle(files: string[]) {
    if (!confirm('Remove downloaded map data from this device?')) return
    for (const f of files) await deleteStoredFile(f)
    setStored(listStored())
    window.location.reload()
  }

  return (
    <div className="panel">
      {BUNDLES.map((b) => {
        const have = b.files.filter((f) => storedNames.has(f))
        const complete = have.length === b.files.length
        const bundleSize = stored.filter((s) => b.files.includes(s.name)).reduce((sum, s) => sum + s.size, 0)
        // with part of the bundle saved, what the server has that the phone lacks (new or rebaked) is one button
        const offerNew = have.length > 0 && pending.length > 0 && !dl?.active
        return (
          <div key={b.id} className="bundle glass-inset">
            <div className="bundle-head">
              <div>
                <div className="row-title">{b.name}</div>
                <div className="row-desc">{b.description}</div>
              </div>
            </div>

            {dl?.active && (
              <div className="dl-progress">
                <div className="dl-progress-label">
                  <span>
                    {dl.file} ({dl.fileIdx}/{dl.fileCount})
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

            {offerNew && (
              <div className="bundle-update">
                <div className="row-title">New maps on the server</div>
                <div className="row-desc">
                  {pending.map((p) => `${p.label}${p.why === 'new' ? ' (new)' : ''}`).join(', ')} · {fmtBytes(pending.reduce((a, p) => a + p.size, 0))}
                </div>
                <button className="btn-primary" disabled={!online} onClick={() => void downloadBundle(pending.map((p) => p.name), true)}>
                  <IconDownload size={18} />
                  {online ? 'Download the new maps' : 'Connect to download'}
                </button>
              </div>
            )}

            {error && <div className="dl-error">{error}</div>}
            {skipped.length > 0 && (
              <div className="row-desc">Not built yet: {skipped.join(', ')}</div>
            )}

            <div className="bundle-actions">
              {have.length > 0 && (
                <span className="bundle-status ok">
                  <IconCheck size={16} /> {have.length}/{b.files.length} files · {fmtBytes(bundleSize)}
                </span>
              )}
              {have.length > 0 && (
                <button className="icon-btn danger" onClick={() => void removeBundle(b.files)} aria-label="Remove">
                  <IconTrash size={18} />
                </button>
              )}
              {!complete &&
                !offerNew &&
                (dl?.active ? (
                  <span className="bundle-status">Downloading…</span>
                ) : (
                  <button className="btn-primary" disabled={!online} onClick={() => void downloadBundle(b.files)}>
                    <IconDownload size={18} />
                    {online ? 'Download for offline use' : 'Connect to download'}
                  </button>
                ))}
            </div>
          </div>
        )
      })}

      {quota && quota.quota > 0 && (
        <div className="quota row-desc">
          Storage: {fmtBytes(quota.usage)} used of {fmtBytes(quota.quota)} available
        </div>
      )}
      <div className="panel-note row-desc">
        Live map services are cached as you look at them. Baked data covers the whole region.
      </div>
    </div>
  )
}
