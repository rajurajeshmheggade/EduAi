/// <reference lib="webworker" />
/**
 * On-device proctoring models in a dedicated worker (the main thread only grabs frames):
 *   MediaPipe FaceLandmarker  faces (≤ 3, confidence ≥ 0.6), head pose from the transformation matrix, face box
 *   MediaPipe ObjectDetector  EfficientDet-Lite0 (COCO): cell phone, book, laptop, tv, person
 *   face-api recognition net  128-d face descriptor for matching against the ID photo (never leaves the browser)
 * Blendshapes / expressions are NOT computed. Models are self-hosted under /models/proctor (npm run models:proctor).
 */
import { FaceLandmarker, FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { headPose, luminance } from './rules'

type FaceApi = typeof import('@vladmandic/face-api')

export type WorkerIn =
  | { type: 'init'; base: string; embed: boolean; objects: boolean }
  | { type: 'frame'; id: number; ts: number; bitmap: ImageBitmap; objects: boolean; embed: boolean }

export interface FrameResult {
  type: 'result'
  id: number
  faces: number
  pose: { yaw: number; pitch: number; roll: number } | null
  box: { x: number; y: number; w: number; h: number } | null
  centred: boolean
  luma: { mean: number; std: number }
  objects: { label: string; score: number }[]
  embedding: number[] | null
  ms: number
}
export type WorkerOut = { type: 'ready'; backend: string } | { type: 'error'; message: string } | FrameResult

const ctx = self as unknown as DedicatedWorkerGlobalScope
let face: FaceLandmarker | null = null
let detector: ObjectDetector | null = null
let api: FaceApi | null = null
let backend = 'none'
const small = new OffscreenCanvas(64, 48)
const crop = new OffscreenCanvas(150, 150)

async function createFace(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, base: string, delegate: 'GPU' | 'CPU') {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}/mediapipe/face_landmarker.task`, delegate },
    runningMode: 'VIDEO', numFaces: 3, minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true,
  })
}

async function init(base: string, embed: boolean, objects: boolean) {
  const fileset = await FilesetResolver.forVisionTasks(`${base}/mediapipe`, true)
  // MediaPipe clears self.ModuleFactory after creating a task; an ES-module loader is cached by import() and does not
  // set it again, so keep the factory and put it back before every task we create.
  const loader = await import(/* @vite-ignore */ `${base}/mediapipe/vision_wasm_module_internal.js`)
  const factory = loader.default ?? (self as unknown as { ModuleFactory: unknown }).ModuleFactory
  const withFactory = <T,>(make: () => Promise<T>) => { (self as unknown as { ModuleFactory: unknown }).ModuleFactory = factory; return make() }
  try { face = await withFactory(() => createFace(fileset, base, 'GPU')); backend = 'gpu' } catch { face = await withFactory(() => createFace(fileset, base, 'CPU')); backend = 'cpu' }
  if (objects) {
    detector = await withFactory(() => ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}/mediapipe/efficientdet_lite0.tflite`, delegate: 'CPU' },
      runningMode: 'IMAGE', scoreThreshold: 0.45, maxResults: 8, categoryAllowlist: ['cell phone', 'book', 'laptop', 'tv', 'person'],
    }))
  }
  if (embed) {
    api = await import('@vladmandic/face-api')
    // face-api looks for a DOM; in a worker give it the OffscreenCanvas equivalents and fetch.
    api.env.setEnv({
      Canvas: OffscreenCanvas as unknown as typeof HTMLCanvasElement, CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D as unknown as typeof CanvasRenderingContext2D,
      Image: class {} as unknown as typeof HTMLImageElement, ImageData, Video: class {} as unknown as typeof HTMLVideoElement,
      createCanvasElement: () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement,
      createImageElement: () => ({}) as HTMLImageElement, createVideoElement: () => ({}) as HTMLVideoElement,
      fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, init), readFile: () => { throw new Error('no file system') },
    })
    const tf = api.tf as unknown as { setBackend(b: string): Promise<boolean>; ready(): Promise<void>; getBackend(): string }
    try { if (!(await tf.setBackend('webgl'))) throw new Error('no webgl') } catch { await tf.setBackend('cpu') }
    await tf.ready()
    backend += ` + face-api ${tf.getBackend()}`
    await api.nets.faceRecognitionNet.loadFromUri(`${base}/face-api`)
  }
}

async function describe(bitmap: ImageBitmap, box: NonNullable<FrameResult['box']>): Promise<number[] | null> {
  if (!api) return null
  const W = bitmap.width
  const H = bitmap.height
  const size = Math.max(box.w * W, box.h * H) * 1.25
  const c = crop.getContext('2d', { willReadFrequently: true })!
  c.drawImage(bitmap, (box.x + box.w / 2) * W - size / 2, (box.y + box.h / 2) * H - size / 2, size, size, 0, 0, 150, 150)
  const input = api.tf.browser.fromPixels(c.getImageData(0, 0, 150, 150))
  try {
    const d = await api.nets.faceRecognitionNet.computeFaceDescriptor(input as never)
    return Array.from(d as Float32Array)
  } finally {
    input.dispose()
  }
}

async function frame(m: Extract<WorkerIn, { type: 'frame' }>): Promise<FrameResult> {
  const t0 = performance.now()
  const { bitmap } = m
  const res = face!.detectForVideo(bitmap, m.ts)
  const faces = res.faceLandmarks.length
  let box: FrameResult['box'] = null
  let pose: FrameResult['pose'] = null
  if (faces) {
    const pts = res.faceLandmarks[0]
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    const mtx = res.facialTransformationMatrixes?.[0]?.data
    if (mtx) pose = headPose(mtx)
  }
  const s = small.getContext('2d', { willReadFrequently: true })!
  s.drawImage(bitmap, 0, 0, 64, 48)
  const luma = luminance(s.getImageData(0, 0, 64, 48).data)
  let objects: FrameResult['objects'] = []
  if (m.objects && detector) {
    objects = detector.detect(bitmap).detections.map((d) => ({ label: d.categories[0]?.categoryName ?? '', score: Math.round((d.categories[0]?.score ?? 0) * 100) / 100 }))
  }
  const embedding = m.embed && faces === 1 && box ? await describe(bitmap, box).catch(() => null) : null
  const centred = !!box && Math.abs(box.x + box.w / 2 - 0.5) < 0.25 && Math.abs(box.y + box.h / 2 - 0.5) < 0.3 && box.w > 0.12
  bitmap.close()
  return { type: 'result', id: m.id, faces, pose, box, centred, luma, objects, embedding, ms: Math.round(performance.now() - t0) }
}

ctx.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      await init(m.base, m.embed, m.objects)
      ctx.postMessage({ type: 'ready', backend } satisfies WorkerOut)
    } else if (m.type === 'frame') {
      if (!face) { m.bitmap.close(); return }
      ctx.postMessage(await frame(m) satisfies WorkerOut)
    }
  } catch (err) {
    if (m.type === 'frame') m.bitmap.close?.()
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerOut)
  }
}
