// Raw PCM helpers for the Gemini Live API — battle-tested voice pipeline.
// Input to Gemini: 16-bit signed little-endian PCM, 16kHz, mono.
// Output from Gemini: 16-bit signed little-endian PCM, 24kHz, mono.

export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < input.length; i++) {
    let s = Math.max(-1, Math.min(1, input[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(i * 2, s, true)
  }
  return buffer
}

// Downsample a Float32 buffer from the mic's native rate to 16kHz.
export function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === 16000) return input
  const ratio = inRate / 16000
  const outLength = Math.round(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const next = Math.round((i + 1) * ratio)
    let sum = 0
    let count = 0
    for (let j = Math.round(i * ratio); j < next && j < input.length; j++) {
      sum += input[j]
      count++
    }
    out[i] = count > 0 ? sum / count : 0
  }
  return out
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

// Streaming player for 24kHz PCM chunks, scheduled gaplessly.
// Supports hard-stop for barge-in (model interruption).
export class PcmPlayer {
  private ctx: AudioContext
  private nextTime = 0
  private sources: AudioBufferSourceNode[] = []
  private rate: number

  constructor(rate = 24000) {
    this.rate = rate
    this.ctx = new AudioContext({ sampleRate: rate })
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume()
  }

  enqueue(pcm: Int16Array) {
    if (pcm.length === 0) return
    const float = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 0x8000
    const buffer = this.ctx.createBuffer(1, float.length, this.rate)
    buffer.copyToChannel(float, 0)

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.ctx.destination)

    const now = this.ctx.currentTime
    const start = Math.max(now, this.nextTime)
    src.start(start)
    this.nextTime = start + buffer.duration
    this.sources.push(src)
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src)
    }
  }

  // Barge-in: stop everything immediately.
  flush() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {}
    }
    this.sources = []
    this.nextTime = 0
  }

  get speaking() {
    return this.sources.length > 0
  }

  close() {
    this.flush()
    try {
      this.ctx.close()
    } catch {}
  }
}
