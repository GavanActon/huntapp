import { useMemo, useState, type ReactNode } from 'react'
import guide from '../../../../docs/HUNTOS.md?raw'

/**
 * How we hunt here, its own sheet beside Settings in the ⋯ menu: the field guide (docs/HUNTOS.md, bundled at build
 * time so it reads offline), one folded section per heading, and a search
 * that opens the sections holding the words. The doc is the one source:
 * edit it after a hunt and the app has it on the next build.
 */

interface Section {
  title: string
  lines: string[]
}

/** The doc split at its "## " headings; what comes before the first is the preface. */
function sections(md: string): Section[] {
  const out: Section[] = []
  let cur: Section = { title: '', lines: [] }
  for (const raw of md.split(/\r?\n/)) {
    if (raw.startsWith('# ')) continue
    if (raw.startsWith('## ')) {
      if (cur.title || cur.lines.some((l) => l.trim())) out.push(cur)
      cur = { title: raw.slice(3).trim(), lines: [] }
      continue
    }
    if (raw.trim() === '---') continue
    cur.lines.push(raw)
  }
  if (cur.title || cur.lines.some((l) => l.trim())) out.push(cur)
  return out
}

/** **bold** and `code`, nothing more. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`(.+?)`/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(m[1] != null ? <b key={k++}>{m[1]}</b> : <code key={k++}>{m[2]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

type Block = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: { text: string; sub: { kind: 'ul' | 'ol'; items: string[] } | null }[] }

/** Paragraphs and lists from the doc's lines: a bullet or a number starts an
 *  item, an indented line carries on the one before it, an indented bullet or
 *  number is a list inside the item. Two levels is all the doc uses. */
function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flushP = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') })
    para = []
  }
  const item = (s: string) => /^(-\s+|\d+\.\s+)/.exec(s)
  for (const raw of lines) {
    if (!raw.trim()) {
      flushP()
      continue
    }
    const indent = raw.length - raw.trimStart().length
    const s = raw.trim()
    const m = item(s)
    const list = out[out.length - 1]
    if (m && indent === 0) {
      flushP()
      const kind = s.startsWith('-') ? 'ul' : 'ol'
      const text = s.slice(m[0].length)
      if (list && list.kind === kind && !para.length) list.items.push({ text, sub: null })
      else out.push({ kind, items: [{ text, sub: null }] })
      continue
    }
    if (indent > 0 && list && list.kind !== 'p' && !para.length) {
      const it = list.items[list.items.length - 1]
      if (m) {
        const kind = s.startsWith('-') ? 'ul' : 'ol'
        if (!it.sub) it.sub = { kind, items: [] }
        it.sub.items.push(s.slice(m[0].length))
      } else if (it.sub) it.sub.items[it.sub.items.length - 1] += ` ${s}`
      else it.text += ` ${s}`
      continue
    }
    para.push(s)
  }
  flushP()
  return out
}

function Body({ lines }: { lines: string[] }) {
  return (
    <>
      {blocks(lines).map((b, i) => {
        if (b.kind === 'p') return <p key={i}>{inline(b.text)}</p>
        const L = b.kind
        return (
          <L key={i}>
            {b.items.map((it, j) => {
              const S = it.sub?.kind ?? 'ul'
              return (
                <li key={j}>
                  {inline(it.text)}
                  {it.sub && (
                    <S>
                      {it.sub.items.map((t, k) => (
                        <li key={k}>{inline(t)}</li>
                      ))}
                    </S>
                  )}
                </li>
              )
            })}
          </L>
        )
      })}
    </>
  )
}

export default function GuideSection() {
  const [q, setQ] = useState('')
  const all = useMemo(() => sections(guide), [])
  const needle = q.trim().toLowerCase()
  const shown = needle ? all.filter((s) => `${s.title}\n${s.lines.join('\n')}`.toLowerCase().includes(needle)) : all
  return (
    <div className="guide">
      <input type="search" className="guide-search" placeholder="Find in the guide" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in the guide" />
      {shown.length === 0 && <div className="row-desc" style={{ padding: '4px' }}>Nothing on that.</div>}
      {shown.map((s, i) =>
        s.title ? (
          <details key={s.title} className="guide-sec" open={needle ? true : undefined}>
            <summary>{s.title}</summary>
            <Body lines={s.lines} />
          </details>
        ) : (
          <div key={`pre${i}`} className="guide-pre row-desc">
            <Body lines={s.lines} />
          </div>
        ),
      )}
    </div>
  )
}
