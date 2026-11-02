// Self-hosts the admission-test proctoring models under public/models/proctor/ (no third-party CDN at runtime).
//   npm run models:proctor
// Copies the MediaPipe WASM runtime and the face-recognition weights from node_modules and downloads the two
// MediaPipe model files from Google's model storage once. Files are served with immutable cache headers in production.
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'models', 'proctor')
const nm = join(root, 'node_modules')

const COPY = [
  ['@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js', 'mediapipe/vision_wasm_module_internal.js'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm', 'mediapipe/vision_wasm_module_internal.wasm'],
  ['@vladmandic/face-api/model/face_recognition_model-weights_manifest.json', 'face-api/face_recognition_model-weights_manifest.json'],
  ['@vladmandic/face-api/model/face_recognition_model.bin', 'face-api/face_recognition_model.bin'],
]
const DOWNLOAD = [
  ['https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', 'mediapipe/face_landmarker.task', 3_758_596],
  ['https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite', 'mediapipe/efficientdet_lite0.tflite', 4_602_795],
]

const exists = async (p, size) => { try { const s = await stat(p); return size ? s.size === size : s.size > 0 } catch { return false } }

for (const [from, to] of COPY) {
  const dest = join(out, to)
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(join(nm, from), dest)
  console.log('copied   ', to)
}
for (const [url, to, size] of DOWNLOAD) {
  const dest = join(out, to)
  if (await exists(dest, size)) { console.log('present  ', to); continue }
  await mkdir(dirname(dest), { recursive: true })
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length !== size) throw new Error(`${to}: expected ${size} bytes, got ${buf.length}`)
  await writeFile(dest, buf)
  console.log('downloaded', to, buf.length)
}
