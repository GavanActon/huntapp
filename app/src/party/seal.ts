import { b64url, fromB64url } from './partyCode'

/**
 * Sealing what a party shares (docs/PARTY.md): AES-GCM under the party's
 * key, a fresh 12-byte iv each time, and the party, the sender and their
 * counter bound in as associated data, so the Worker cannot hand one
 * member's item to the others as someone else's. Sealed is base64url of
 * the iv and the ciphertext; a wrong key, a changed byte or a relabelled
 * item opens to null.
 */

const keys = new Map<string, Promise<CryptoKey>>()

function keyFor(key: string): Promise<CryptoKey> {
  let k = keys.get(key)
  if (!k) {
    k = crypto.subtle.importKey('raw', fromB64url(key) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
    keys.set(key, k)
  }
  return k
}

const aad = (party: string, member: string, seq: number) => new TextEncoder().encode(`${party}|${member}|${seq}`)

export async function seal(key: string, party: string, member: string, seq: number, data: unknown): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(party, member, seq) }, await keyFor(key), new TextEncoder().encode(JSON.stringify(data)))
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), 12)
  return b64url(out)
}

export async function open(key: string, party: string, member: string, seq: number, sealed: string): Promise<unknown> {
  try {
    const all = fromB64url(sealed)
    if (all.length < 12 + 16) return null
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: aad(party, member, seq) }, await keyFor(key), all.slice(12))
    return JSON.parse(new TextDecoder().decode(pt)) as unknown
  } catch {
    return null
  }
}
