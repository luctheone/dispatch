// WebAudio two-note completion ding — no audio asset files.
// 880Hz → 1320Hz sine, ~250ms total, soft attack/decay envelope.
// Throttled so a turn_done that completes several cards at once rings once.

let ctx: AudioContext | null = null
let lastPlayed = 0

function note(audio: AudioContext, freq: number, start: number, duration: number): void {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = "sine"
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(0.22, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

export function playChime(): void {
  const now = Date.now()
  if (now - lastPlayed < 200) return
  lastPlayed = now

  if (!ctx) ctx = new AudioContext()
  if (ctx.state === "suspended") void ctx.resume()
  const t0 = ctx.currentTime
  note(ctx, 880, t0, 0.16)
  note(ctx, 1320, t0 + 0.09, 0.2)
}
