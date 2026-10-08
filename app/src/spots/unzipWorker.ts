/**
 * Band files unpacked off the main thread. The browser's own
 * DecompressionStream does its work on the thread that reads it: on the
 * main thread the habitat grid alone was some 80 ms of the phone's launch,
 * the ground model's more, as the wind streaks were starting. Here it is a
 * thread of its own, and the bytes go back transferred, not copied. A job
 * is a whole v1 file (gzip) or a batch of v2 bands (zlib, 'deflate').
 */
export type ToUnzip = { id: number; format: 'gzip' | 'deflate'; parts: Blob[] }
export type FromUnzip = { id: number; bufs: ArrayBuffer[] } | { id: number; error: string }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ToUnzip>) => void) | null; postMessage: (m: FromUnzip, transfer?: Transferable[]) => void }

ctx.onmessage = async (e) => {
  const { id, format, parts } = e.data
  try {
    const bufs = await Promise.all(parts.map((p) => new Response(p.stream().pipeThrough(new DecompressionStream(format))).arrayBuffer()))
    ctx.postMessage({ id, bufs }, bufs)
  } catch (err) {
    ctx.postMessage({ id, error: (err as Error).message })
  }
}
