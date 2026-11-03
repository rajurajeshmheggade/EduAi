/* Microphone capture helpers for Aura Live's server transcription fallback (MindAlign utils/audioCapture.js). */

/** Samples per message posted from the capture worklet (~85 ms at 48 kHz). */
export const CAPTURE_CHUNK_SIZE = 4096

/** AudioWorklet that streams raw mono PCM from the microphone to the page in CAPTURE_CHUNK_SIZE batches. */
export const PCM_CAPTURE_WORKLET = `
class AuraPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${CAPTURE_CHUNK_SIZE});
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('aura-pcm-capture', AuraPcmCapture);
`

/**
 * Encodes mono Float32 PCM chunks as a 16-bit PCM WAV file, downsampled to `targetSampleRate`.
 * WAV transcribes reliably, and 16 kHz mono keeps a minute of speech under 2 MB.
 * @param chunks Captured samples in order.
 * @param inputSampleRate Sample rate of the captured audio (the AudioContext rate).
 * @param targetSampleRate Output sample rate (never above the input rate).
 * @returns The complete WAV file.
 */
export function encodeWav(chunks: readonly Float32Array[], inputSampleRate: number, targetSampleRate = 16000): ArrayBuffer {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  const outputRate = Math.min(inputSampleRate, targetSampleRate)
  const ratio = inputSampleRate / outputRate
  const outputSamples = Math.floor(totalSamples / ratio)
  const pcm = new Int16Array(outputSamples)
  for (let i = 0; i < outputSamples; i++) {
    // Average each window of source samples (a simple low-pass filter while downsampling)
    const start = Math.floor(i * ratio)
    const end = Math.max(start + 1, Math.min(totalSamples, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = start; j < end; j++) sum += merged[j]
    const sample = Math.max(-1, Math.min(1, sum / (end - start)))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buffer)
  const writeAscii = (position: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(position + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, outputRate, true) // sample rate
  view.setUint32(28, outputRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  new Int16Array(buffer, 44).set(pcm)
  return buffer
}

/** The recorded turn as an `audio/wav` Blob, ready for `wellnessService.transcribe`. */
export function encodeWavBlob(chunks: readonly Float32Array[], inputSampleRate: number): Blob {
  return new Blob([encodeWav(chunks, inputSampleRate)], { type: 'audio/wav' })
}

/** Milliseconds of audio held in `chunkCount` worklet chunks. */
export function recordedMs(chunkCount: number, sampleRate: number): number {
  return (chunkCount * CAPTURE_CHUNK_SIZE * 1000) / sampleRate
}
