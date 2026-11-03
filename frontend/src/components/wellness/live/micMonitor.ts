/* Microphone level monitor (voice activity detection) + raw PCM tap for the server transcription engine.
   Detects the pause from the actual audio, so auto-send also works in browsers that only return text once
   recognition stops. Audio never leaves the page except as the explicit per-turn WAV upload. */
import { PCM_CAPTURE_WORKLET } from './audioCapture'
import { getAudioContextClass, getRecognizerConstructor, SPEECH_LANG } from './speechApi'

export interface MicMonitor {
  stream: MediaStream
  audioContext: AudioContext
  analyser: AnalyserNode
  source: MediaStreamAudioSourceNode
  samples: Float32Array<ArrayBuffer>
  /** Adaptive noise floor (RMS). */
  noiseFloor: number
  /** Raw PCM tap, or null when AudioWorklet is unavailable (then only the browser engine can transcribe). */
  captureNode: AudioWorkletNode | null
}

export interface MicActivity { voice: boolean; level: number }

/** Opens the microphone and an analyser. Resolves null when the browser can't (or the student refuses). */
export async function openMicMonitor(): Promise<MicMonitor | null> {
  const AudioContextClass = getAudioContextClass()
  if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) return null
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const audioContext = new AudioContextClass()
    audioContext.resume().catch(() => {})
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)
    return { stream, audioContext, analyser, source, samples: new Float32Array(analyser.fftSize), noiseFloor: 0.01, captureNode: null }
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop())
    console.warn('Voice activity monitor unavailable, relying on transcript timing:', err)
    return null
  }
}

/** Raw PCM tap on the microphone, used by the server transcription engine. */
export async function attachPcmCapture(monitor: MicMonitor, onChunk: (chunk: Float32Array) => void): Promise<AudioWorkletNode | null> {
  const { audioContext } = monitor
  if (!audioContext.audioWorklet || typeof AudioWorkletNode === 'undefined') return null
  const moduleUrl = URL.createObjectURL(new Blob([PCM_CAPTURE_WORKLET], { type: 'application/javascript' }))
  try {
    await audioContext.audioWorklet.addModule(moduleUrl)
    const captureNode = new AudioWorkletNode(audioContext, 'aura-pcm-capture')
    captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data)
    // The worklet is only pulled while connected to the output, so route it through a muted gain node
    const mute = audioContext.createGain()
    mute.gain.value = 0
    monitor.source.connect(captureNode)
    captureNode.connect(mute)
    mute.connect(audioContext.destination)
    return captureNode
  } catch (err) {
    console.warn('Microphone capture for transcription unavailable:', err)
    return null
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }
}

/** Stops the microphone tracks and closes the AudioContext. */
export function closeMicMonitor(monitor: MicMonitor | null): void {
  if (!monitor) return
  if (monitor.captureNode) monitor.captureNode.port.onmessage = null
  monitor.stream.getTracks().forEach((t) => t.stop())
  if (monitor.audioContext.state !== 'closed') monitor.audioContext.close().catch(() => {})
}

export function readMicActivity(monitor: MicMonitor | null): MicActivity {
  if (!monitor) return { voice: false, level: 0 }
  monitor.analyser.getFloatTimeDomainData(monitor.samples)
  let sumSquares = 0
  for (let i = 0; i < monitor.samples.length; i++) sumSquares += monitor.samples[i] * monitor.samples[i]
  const rms = Math.sqrt(sumSquares / monitor.samples.length)
  // Adaptive noise floor (drops instantly, rises slowly) so steady fan/AC hum isn't mistaken for speech
  monitor.noiseFloor = rms < monitor.noiseFloor ? rms : monitor.noiseFloor * 0.98 + rms * 0.02
  return {
    voice: rms > Math.max(monitor.noiseFloor * 3, 0.015),
    level: Math.min(1, Math.sqrt(Math.max(0, rms - monitor.noiseFloor) / 0.12)),
  }
}

/**
 * Chrome can run speech recognition fully on-device, which needs no network (so proxies can't break it).
 * Resolves true when the English model is installed; otherwise starts downloading it in the background and
 * calls `onInstalled` once it is ready for later turns.
 */
export async function prepareOnDeviceRecognition(onInstalled: () => void): Promise<boolean> {
  const Ctor = getRecognizerConstructor()
  if (typeof Ctor?.available !== 'function') return false
  const options = { langs: [SPEECH_LANG], processLocally: true }
  try {
    const status = await Ctor.available(options)
    if (status === 'available') return true
    if ((status === 'downloadable' || status === 'downloading') && typeof Ctor.install === 'function') {
      Ctor.install(options)
        .then((installed) => { if (installed) onInstalled() })
        .catch((err: unknown) => console.warn('On-device speech model install failed:', err))
    }
  } catch (err) {
    console.warn('On-device speech recognition check failed:', err)
  }
  return false
}
