/**
 * Downloads a 3D avatar model (GLB) once per page load, reporting progress, and hands it to three.js as an object
 * URL — so the AI Classroom can show a real progress bar while the ~5 MB model arrives, then render it instantly.
 */
const models = new Map<string, Promise<string>>()

export function loadAvatarModel(url: string, onProgress?: (fraction: number) => void): Promise<string> {
  let p = models.get(url)
  if (p) {
    if (onProgress) void p.then(() => onProgress(1), () => {})
    return p
  }
  p = download(url, onProgress)
  models.set(url, p)
  p.catch(() => models.delete(url))        // a failed download is tried again next time
  return p
}

async function download(url: string, onProgress?: (fraction: number) => void): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`The 3D avatar could not be downloaded (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total) {
    const blob = await res.blob()
    onProgress?.(1)
    return URL.createObjectURL(blob)
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(Math.min(1, received / total))
  }
  return URL.createObjectURL(new Blob(chunks, { type: 'model/gltf-binary' }))
}
