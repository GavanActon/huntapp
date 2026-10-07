/**
 * A party's invite (docs/PARTY.md): the party's random id and its key, as
 * one code, "<id>.<key>". The id names the party's mailbox on the Worker;
 * the key seals and opens what goes in it, and never leaves the phones.
 *
 *   the link:   <base>?area=pickle-lake#party=<id>.<key>&pn=GA%27s+party
 *   the code:   GW-PARTY <id>.<key>  (to paste where a link opens the wrong app)
 *
 * The code rides in the fragment, which no server, no redirect log and no
 * link preview ever sees. Reading is lenient: the link, the code with or
 * without its tag, or the bare "<id>.<key>" all join.
 *
 * Pure, with no imports.
 */

export interface PartyInvite {
  id: string
  /** 16 bytes, base64url: the AES-GCM key */
  key: string
  /** what the one who made it called it */
  name?: string
  /** the area the inviter runs in, so the link opens there */
  area?: string
}

export const CODE_TAG = 'GW-PARTY'

const ID = /^[A-Za-z0-9_-]{12,32}$/
const KEY = /^[A-Za-z0-9_-]{22}$/
const AREA = /^[a-z0-9-]{1,40}$/

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

function random(n: number): Uint8Array {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return a
}

/** A new party: 12 characters of id, a 128-bit key. */
export function newParty(name?: string): PartyInvite {
  return { id: b64url(random(9)), key: b64url(random(16)), ...(name ? { name } : {}) }
}

/** This phone in a party: 8 hex, new for every party it joins. */
export function newMemberId(): string {
  return [...random(4)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const cleanName = (v: string | null | undefined) =>
  (v ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || undefined

/** "<id>.<key>", the part that joins. */
export function partyCode(p: PartyInvite): string {
  return `${p.id}.${p.key}`
}

/** The invite as a link to the app. */
export function partyLink(base: string, p: PartyInvite): string {
  const u = new URL(base)
  u.search = p.area && AREA.test(p.area) ? new URLSearchParams({ area: p.area }).toString() : ''
  const h = new URLSearchParams()
  h.set('party', partyCode(p))
  const name = cleanName(p.name)
  if (name) h.set('pn', name)
  u.hash = h.toString()
  return u.toString()
}

function fromCode(code: string): { id: string; key: string } | null {
  const m = /^([A-Za-z0-9_-]{12,32})\.([A-Za-z0-9_-]{22})$/.exec(code.trim())
  return m && ID.test(m[1]) && KEY.test(m[2]) ? { id: m[1], key: m[2] } : null
}

/** An invite from anything pasted or opened: the link, the tagged code, or the bare code. */
export function readInvite(text: string): PartyInvite | null {
  const t = text.trim()
  // a link: the fragment's party= (or the query's, for one typed by hand)
  const link = /https?:\/\/\S+/.exec(t)?.[0]
  if (link) {
    try {
      const u = new URL(link)
      const h = new URLSearchParams(u.hash.replace(/^#/, ''))
      const code = fromCode(h.get('party') ?? u.searchParams.get('party') ?? '')
      if (code) {
        const area = u.searchParams.get('area') ?? undefined
        const name = cleanName(h.get('pn') ?? u.searchParams.get('pn'))
        return { ...code, ...(name ? { name } : {}), ...(area && AREA.test(area) ? { area } : {}) }
      }
    } catch {
      /* not a link after all */
    }
  }
  const m = new RegExp(`(?:${CODE_TAG}\\s+)?([A-Za-z0-9_-]{12,32}\\.[A-Za-z0-9_-]{22})`).exec(t)
  return m ? fromCode(m[1]) : null
}

/** A member's colour, the same on every phone: from their id, not the order they joined in. */
const COLOURS = ['#ff9f43', '#4fc3f7', '#c792ea', '#f06292', '#9ccc65', '#ffd54f', '#4db6ac', '#ff8a65']
export function memberColour(mid: string): string {
  let h = 0
  for (let i = 0; i < mid.length; i++) h = (h * 31 + mid.charCodeAt(i)) >>> 0
  return COLOURS[h % COLOURS.length]
}
