/**
 * A baked band file unzipped off the main thread. The browser's own
 * DecompressionStream does its work on the thread that reads it: on the
 * main thread the habitat grid alone was some 80 ms of the phone's launch,
 * the ground model's more, as the wind streaks were starting. Here it is a
 * thread of its own, and the bytes go back transferred, not copied.
 */
export type ToUnzip = { id: number; blob: Blob }
export type FromUnzip = { id: number; buf: ArrayBuffer } | { id: number; error: string }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ToUnzip>) => void) | null; postMessage: (m: FromUnzip, transfer?: Transferable[]) => void }

ctx.onmessage = async (e) => {
  const { id, blob } = e.data
  try {
    const buf = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    ctx.postMessage({ id, buf }, [buf])
  } catch (err) {
    ctx.postMessage({ id, error: (err as Error).message })
  }
}
