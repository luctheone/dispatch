import { useCallback, useEffect, useRef, useState } from "react"
import {
  GoogleGenAI,
  Modality,
  EndSensitivity,
  StartSensitivity,
  type LiveServerMessage,
  type Session,
} from "@google/genai"
import { PcmPlayer, downsampleTo16k, floatTo16BitPCM, arrayBufferToBase64, base64ToInt16 } from "./audio"
import { DISPATCHER_TOOLS, DISPATCHER_SYSTEM_INSTRUCTION } from "./dispatcher-tools"
import type { VoiceApi, VoiceStatus, ToolHandler } from "../../../shared/types"

// Battle-tested Gemini Live voice pipeline.
// Changes for Dispatch: direct API key (desktop app — no token-mint server),
// dispatcher tools/system-instruction, input transcription enabled so the
// HUD shows the user's words AS they speak, VAD tuned for clause-level
// end-of-speech, mic RMS level for the HUD meter, and silent reconnect for
// the 15-minute Live session cap. Preserved workarounds:
//  - double-session guard (two overlapping sessions = two voices at once)
//  - text injected mid-model-turn is queued (Gemini Live duplicate-response bug)
//  - barge-in flushes the player immediately
//  - error paths call stop() FIRST, then setStatus("error")

const LIVE_MODEL = "gemini-3.1-flash-live-preview"
const DEFAULT_SILENCE_MS = 450
const RECONNECT_DELAY_MS = 400
const RECONNECT_WINDOW_MS = 15 * 60 * 1000
const MAX_RECONNECTS_PER_WINDOW = 3
const PROACTIVE_RECONNECT_MS = 13 * 60 * 1000 // beat the 15-min session cap
const LEVEL_EMIT_INTERVAL_MS = 100 // ~10 setState/sec for the RMS meter
const CONNECT_TIMEOUT_MS = 12 * 1000 // orb can't sit forever in "connecting"

// User-facing failure messages — specific so the HUD banner is actionable.
const ERR_MIC_BLOCKED = "Microphone access is blocked. Grant it in the permissions panel and try again."
const ERR_MIC_MISSING = "No microphone was found. Connect one and try again."
const ERR_CONNECT_FAILED = "Couldn't reach the voice service. Check your connection or Gemini key."
const ERR_UNSUPPORTED = "Voice isn't supported in this build."
const ERR_CONNECT_TIMEOUT = "Voice took too long to connect."

type StartOpts = Parameters<VoiceApi["start"]>[0]

export function useLiveDispatcher(): VoiceApi {
  const [status, setStatus] = useState<VoiceStatus>("idle")
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState("") // live transcript of the USER's speech
  const [level, setLevel] = useState(0) // 0..1 mic RMS, throttled ~10Hz
  const [error, setError] = useState<string | null>(null) // actionable failure reason for the HUD banner

  const sessionRef = useRef<Session | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const handlerRef = useRef<ToolHandler | null>(null)
  const startingRef = useRef(false)
  const modelTurnRef = useRef(false)
  const pendingTextRef = useRef<string[]>([])
  const heardRef = useRef("")
  const statusRef = useRef<VoiceStatus>("idle")
  const levelEmitAtRef = useRef(0)
  // Silent-reconnect machinery (15-min Live session cap resilience).
  const startOptsRef = useRef<StartOpts | null>(null)
  const intentionalStopRef = useRef(false)
  const silentSwapRef = useRef(false)
  const sessionGenRef = useRef(0) // bumped on every teardown; stale callbacks no-op
  const reconnectTimesRef = useRef<number[]>([])
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const proactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // 12s connect watchdog

  const setStatusTracked = (s: VoiceStatus) => {
    statusRef.current = s
    setStatus(s)
  }

  const flushPendingText = () => {
    const s = sessionRef.current
    if (!s) return
    const queued = pendingTextRef.current
    pendingTextRef.current = []
    for (const t of queued) {
      try {
        s.sendRealtimeInput({ text: t })
      } catch {}
    }
  }

  const sendTextSafely = (text: string) => {
    if (modelTurnRef.current) {
      pendingTextRef.current.push(text)
      return
    }
    try {
      sessionRef.current?.sendRealtimeInput({ text })
    } catch {}
  }

  const clearTimers = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (proactiveTimerRef.current) {
      clearTimeout(proactiveTimerRef.current)
      proactiveTimerRef.current = null
    }
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current)
      connectTimerRef.current = null
    }
  }

  // Tear down audio + session WITHOUT touching status — shared by stop() and
  // the silent session swap. Bumping the generation makes every callback from
  // the old session a no-op.
  const teardown = () => {
    sessionGenRef.current++
    try {
      processorRef.current?.disconnect()
    } catch {}
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    try {
      audioCtxRef.current?.close()
    } catch {}
    try {
      sessionRef.current?.close()
    } catch {}
    playerRef.current?.close()
    processorRef.current = null
    streamRef.current = null
    audioCtxRef.current = null
    sessionRef.current = null
    playerRef.current = null
    startingRef.current = false
    modelTurnRef.current = false
    pendingTextRef.current = []
  }

  const stop = useCallback(() => {
    intentionalStopRef.current = true
    clearTimers()
    teardown()
    heardRef.current = ""
    setHeard("")
    setListening(false)
    setSpeaking(false)
    setLevel(0)
    setError(null)
    setStatusTracked("idle")
  }, [])

  // Restart with the saved opts. Status stays "live" through the swap; the
  // dispatcher sends no greeting, so the swap is inaudible.
  const restartSession = async () => {
    const opts = startOptsRef.current
    if (!opts || intentionalStopRef.current) return
    silentSwapRef.current = true
    teardown()
    try {
      await connect(opts)
    } finally {
      silentSwapRef.current = false
    }
  }

  // Unexpected socket death while live → silent reconnect after 400ms,
  // budgeted at 3 attempts per 15 minutes.
  const scheduleReconnect = () => {
    if (intentionalStopRef.current || reconnectTimerRef.current) return
    const now = Date.now()
    reconnectTimesRef.current = reconnectTimesRef.current.filter((t) => now - t < RECONNECT_WINDOW_MS)
    if (reconnectTimesRef.current.length >= MAX_RECONNECTS_PER_WINDOW) {
      // Reconnect budget exhausted — the silent machinery has given up, so this
      // is no longer invisible; surface it to the user.
      stop()
      setError(ERR_CONNECT_FAILED)
      setStatusTracked("error")
      return
    }
    reconnectTimesRef.current.push(now)
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      void restartSession()
    }, RECONNECT_DELAY_MS)
  }

  async function connect(opts: StartOpts): Promise<void> {
    if (startingRef.current || sessionRef.current) return
    startingRef.current = true
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      startingRef.current = false
      setError(ERR_UNSUPPORTED)
      setStatusTracked("unsupported")
      return
    }

    handlerRef.current = opts.onTool
    const silentSwap = silentSwapRef.current
    const gen = sessionGenRef.current // teardown() bumps this; stale work no-ops
    if (!silentSwap) {
      setStatusTracked("connecting")
      setHeard("")
      setError(null) // clear stale failure at the start of a user-initiated connect
      // Connect watchdog: if onopen/setupComplete never fires, tear down and
      // surface a timeout. Guarded by gen so a late success after the timeout
      // (or any teardown/swap) is ignored.
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current)
      connectTimerRef.current = setTimeout(() => {
        connectTimerRef.current = null
        if (gen !== sessionGenRef.current) return
        if (statusRef.current !== "connecting") return
        stop()
        setError(ERR_CONNECT_TIMEOUT)
        setStatusTracked("error")
      }, CONNECT_TIMEOUT_MS)
    }

    // Hoisted so a getUserMedia failure can't leak the player's AudioContext
    // (Chromium has a per-page cap; flaky-mic reconnects would exhaust it).
    let player: PcmPlayer | null = null
    try {
      player = new PcmPlayer(24000)
      await player.resume()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (gen !== sessionGenRef.current) {
        // stop()/swap raced us while acquiring the mic — don't leak it.
        player.close()
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      playerRef.current = player
      streamRef.current = stream
    } catch (err) {
      player?.close()
      if (silentSwap) {
        teardown()
        scheduleReconnect()
        return
      }
      // Refine the message from the DOMException: NotFoundError/DevicesNotFound
      // means no mic hardware; everything else (NotAllowedError, SecurityError)
      // is a blocked/denied permission.
      const name = (err as DOMException | undefined)?.name
      stop()
      setError(name === "NotFoundError" || name === "DevicesNotFoundError" ? ERR_MIC_MISSING : ERR_MIC_BLOCKED)
      setStatusTracked("error")
      return
    }

    try {
      const ai = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { apiVersion: "v1alpha" } })

      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: DISPATCHER_SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
          },
          tools: [{ functionDeclarations: DISPATCHER_TOOLS }],
          inputAudioTranscription: {},
          // Clause-level VAD: commit end-of-speech fast so dispatches fire
          // mid-sentence instead of waiting out long pauses.
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: opts.silenceMs ?? DEFAULT_SILENCE_MS,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            },
          },
        },
        callbacks: {
          onopen: () => {
            if (gen !== sessionGenRef.current) return
            // Connected — cancel the watchdog so a slow-but-successful open
            // doesn't get torn down later.
            if (connectTimerRef.current) {
              clearTimeout(connectTimerRef.current)
              connectTimerRef.current = null
            }
            setStatusTracked("live")
            setListening(true)
            startMicPump()
            // Proactively swap the session before Gemini's 15-min cap kills it.
            if (proactiveTimerRef.current) clearTimeout(proactiveTimerRef.current)
            proactiveTimerRef.current = setTimeout(() => {
              proactiveTimerRef.current = null
              if (!intentionalStopRef.current && statusRef.current === "live") void restartSession()
            }, PROACTIVE_RECONNECT_MS)
          },
          onmessage: (msg: LiveServerMessage) => {
            if (gen !== sessionGenRef.current) return
            void handleMessage(msg)
          },
          onerror: () => {
            if (gen !== sessionGenRef.current) return
            if (!intentionalStopRef.current && statusRef.current === "live") {
              scheduleReconnect()
              return
            }
            // onerror before we reached "live" = the connect itself failed.
            const failedConnecting = statusRef.current === "connecting"
            // Guard ordering: stop() first (releases mic, resets refs so the
            // orb can restart), THEN the error status — matching every other
            // error path. Without stop(), startingRef/sessionRef stay set and
            // the mic toggle is bricked until app restart.
            stop()
            if (failedConnecting) setError(ERR_CONNECT_FAILED)
            setStatusTracked("error")
          },
          onclose: () => {
            if (gen !== sessionGenRef.current) return
            setListening(false)
            setSpeaking(false)
            if (!intentionalStopRef.current && statusRef.current === "live") scheduleReconnect()
          },
        },
      })
      if (gen !== sessionGenRef.current) {
        // A stop()/swap happened while connecting — this session is orphaned.
        try {
          session.close()
        } catch {}
        return
      }
      sessionRef.current = session
    } catch (err) {
      console.log("[dispatch] live connect error:", (err as Error).message)
      if (silentSwap) {
        teardown()
        scheduleReconnect()
        return
      }
      stop()
      setError(ERR_CONNECT_FAILED)
      setStatusTracked("error")
      return
    }

    function startMicPump() {
      const stream = streamRef.current
      if (!stream) return
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      source.connect(processor)
      processor.connect(ctx.destination)
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        // Mic RMS for the HUD meter — same buffer, no extra audio nodes,
        // throttled to ~10 setState calls/sec.
        const now = performance.now()
        if (now - levelEmitAtRef.current >= LEVEL_EMIT_INTERVAL_MS) {
          levelEmitAtRef.current = now
          let sumSquares = 0
          for (let i = 0; i < input.length; i++) sumSquares += input[i] * input[i]
          setLevel(Math.min(1, Math.sqrt(sumSquares / input.length)))
        }
        const session = sessionRef.current
        if (!session) return
        const down = downsampleTo16k(input, ctx.sampleRate)
        const pcm = floatTo16BitPCM(down)
        try {
          session.sendRealtimeInput({
            audio: { data: arrayBufferToBase64(pcm), mimeType: "audio/pcm;rate=16000" },
          })
        } catch {}
      }
    }

    async function handleMessage(msg: LiveServerMessage) {
      const player = playerRef.current

      if (msg.setupComplete) {
        startingRef.current = false
        return
      }

      // Barge-in: dispatcher was interrupted, drop queued audio.
      if (msg.serverContent?.interrupted) {
        player?.flush()
        setSpeaking(false)
        modelTurnRef.current = false
      }

      // Dispatcher's own (tiny) voice acknowledgements.
      const parts = msg.serverContent?.modelTurn?.parts ?? []
      for (const part of parts) {
        const data = part.inlineData?.data
        if (data && player) {
          modelTurnRef.current = true
          player.enqueue(base64ToInt16(data))
          setSpeaking(true)
        }
      }

      // Live transcript of the USER's words — the HUD paints these as
      // they're spoken, and dispatched chunks light up.
      const inText = msg.serverContent?.inputTranscription?.text
      if (inText) {
        heardRef.current += inText
        setHeard(heardRef.current)
      }

      if (msg.serverContent?.turnComplete) {
        setTimeout(() => setSpeaking(false), 150)
        modelTurnRef.current = false
        flushPendingText()
      }

      // Tool calls: dispatch_task / amend_task / cancel_all / stop_listening.
      const calls = msg.toolCall?.functionCalls
      if (calls && calls.length) {
        const responses = []
        for (const call of calls) {
          let result: unknown = { ok: true }
          try {
            result = (await handlerRef.current?.(call.name ?? "", (call.args as Record<string, unknown>) ?? {})) ?? {
              ok: true,
            }
          } catch (err) {
            result = { ok: false, error: (err as Error).message }
          }
          responses.push({ id: call.id, name: call.name, response: { result } })
        }
        try {
          sessionRef.current?.sendToolResponse({ functionResponses: responses })
        } catch {}
      }
    }
  }

  const start = useCallback(
    async (opts: StartOpts) => {
      if (startingRef.current || sessionRef.current) return
      intentionalStopRef.current = false
      startOptsRef.current = opts
      reconnectTimesRef.current = []
      await connect(opts)
    },
    // connect/teardown only touch refs and setState, so a first-render closure is safe.
    [stop],
  )

  // Feed agent progress back to the dispatcher so it can answer "what's
  // happening" without interrupting (queued while mid-turn — duplicate-reply guard).
  const tellDispatcher = useCallback((text: string) => {
    sendTextSafely(text)
  }, [])

  // Don't leave reconnect/swap timers running after unmount.
  useEffect(() => {
    return () => {
      intentionalStopRef.current = true
      clearTimers()
    }
  }, [])

  return { status, speaking, listening, heard, level, error, start, stop, tellDispatcher }
}
