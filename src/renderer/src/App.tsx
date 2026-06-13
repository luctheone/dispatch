import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { DispatchApi, PermissionStatus, VoiceApi } from "../../shared/types"
import { useLiveDispatcher } from "./voice/use-live-dispatcher"
import { boardReducer, initialBoard } from "./hud/cards"
import Header, { type AgentStatus } from "./hud/Header"
import Ribbon from "./hud/Ribbon"
import Board from "./hud/Board"
import Footer from "./hud/Footer"
import Onboarding, { ONBOARDING_KEY } from "./hud/Onboarding"
import { ToastHost, useToasts } from "./hud/Toast"
import demoScript from "./demo-script.json"

declare global {
  interface Window {
    dispatch: DispatchApi
  }
}

const DEMO_KEY = "dispatch_demo"

export default function App() {
  // Cross-track boundary: the voice hook implements VoiceApi (shared contract);
  // its file is owned by the voice track, so we bind through the contract type.
  const voice = useLiveDispatcher() as unknown as VoiceApi
  const micLevel = Number.isFinite(voice.level) ? voice.level : 0

  const [board, dispatchBoard] = useReducer(boardReducer, initialBoard)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("starting")
  const [agentDetail, setAgentDetail] = useState<string | null>(null)
  const [geminiKey, setGeminiKey] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState("")
  const [flashKey, setFlashKey] = useState(0)

  // REPLAY is a demo-rehearsal feature, gated behind a flag — never a primary
  // control. Keys 1–5 only fire while this is on.
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem(DEMO_KEY) === "1")

  // Live TCC status drives the onboarding decision (not just a localStorage flag).
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const onboardingDecidedRef = useRef(false)

  // Voice-error banner: mirrors VoiceApi.error; dismissible per message.
  const [errorDismissed, setErrorDismissed] = useState<string | null>(null)
  const voiceError = voice.error && voice.error !== errorDismissed ? voice.error : null

  const toasts = useToasts()
  const pushToast = toasts.push

  const refreshPermissions = useCallback(() => {
    void window.dispatch.getPermissions().then((p) => setPermissions(p))
  }, [])

  // Refs so the single event subscription and global key handler stay current.
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const demoModeRef = useRef(demoMode)
  demoModeRef.current = demoMode
  const pushToastRef = useRef(pushToast)
  pushToastRef.current = pushToast
  const boardRef = useRef(board)
  boardRef.current = board
  // Gemini's dispatch_task can carry a free label; it arrives BEFORE main
  // assigns the card id, so stash it paired with its instruction and attach on
  // the matching 'dispatched' event. Pairing matters: main's 3s dedupe drops
  // duplicate dispatches WITHOUT an event, which would shift an unpaired FIFO
  // onto the wrong card. (A later TokenRouter label simply overwrites it.)
  const pendingLabelsRef = useRef<{ instruction: string; label: string }[]>([])

  useEffect(() => {
    window.dispatch.getConfig().then((c) => {
      setGeminiKey(c.geminiKey ?? localStorage.getItem("gemini_key"))
    })
  }, [])

  // Boot: read actual permission status → decide first-run onboarding by mic
  // status (show when mic isn't granted AND not previously dismissed). Re-poll
  // on window focus throughout the session.
  useEffect(() => {
    void window.dispatch.getPermissions().then((p) => {
      setPermissions(p)
      if (!onboardingDecidedRef.current) {
        onboardingDecidedRef.current = true
        const dismissed = localStorage.getItem(ONBOARDING_KEY) === "1"
        if (p.microphone !== "granted" && !dismissed) setOnboardingOpen(true)
      }
    })
  }, [])

  useEffect(() => {
    const onFocus = () => refreshPermissions()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refreshPermissions])

  // Single agent-event subscription: board reducer + header status + the
  // confirmation loop back to the voice dispatcher.
  useEffect(() => {
    const off = window.dispatch.onAgentEvent((e) => {
      const voiceLive = voiceRef.current.status === "live"
      // Create/update the card FIRST — a synthetic label action below must
      // find the card already in the board or the reducer drops it.
      dispatchBoard({ event: e, voiceLive })

      if (e.kind === "status") {
        setAgentStatus(e.status)
        setAgentDetail(e.detail ?? null)
      } else if (e.kind === "error") {
        setAgentStatus("error")
        setAgentDetail(e.message)
      } else if (e.kind === "dispatched") {
        setFlashKey((k) => k + 1)
        if (!e.text.startsWith("AMENDMENT")) {
          // Drop stale heads (their dispatches were deduped away), then attach
          // only a label whose instruction matches this exact dispatch.
          const q = pendingLabelsRef.current
          while (q.length && q[0].instruction !== e.text) q.shift()
          const pending = q[0]?.instruction === e.text ? q.shift() : undefined
          if (pending) dispatchBoard({ event: { kind: "label", id: e.id, label: pending.label }, voiceLive })
        }
      } else if (e.kind === "text" && e.text.trimStart().startsWith("✓")) {
        const line = e.text.split("\n").find((l) => l.trimStart().startsWith("✓")) ?? e.text
        voiceRef.current.tellDispatcher(`APP REPORT — ${line.trim()}`)
      } else if (e.kind === "turn_done") {
        voiceRef.current.tellDispatcher("APP REPORT — turn complete: every dispatched task is finished.")
      }
    })
    return off
  }, [])

  // Esc / ⌘-. = stop everything; keys 1–5 fire replay dispatches (never while
  // a text field is focused, and only in demo mode).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || (ev.metaKey && ev.key === ".")) {
        stopEverything()
        return
      }
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if (demoModeRef.current && ev.key >= "1" && ev.key <= "5") {
        const line = demoScript[Number(ev.key) - 1]
        if (line) window.dispatch.send(line)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Stop Everything: toast immediately (don't wait for the agent), then interrupt.
  const stopEverything = useCallback(() => {
    const running = boardRef.current.cards.some((c) => c.status === "QUEUED" || c.status === "ACTING")
    pushToastRef.current(running ? "Stopped." : "Nothing running.", running ? "neutral" : "neutral")
    window.dispatch.interrupt()
  }, [])

  function onDispatcherTool(name: string, args: Record<string, unknown>) {
    if (name === "open_app") {
      // Fast lane: no agent round-trip.
      const appName = String(args.name ?? "").trim()
      if (appName) window.dispatch.runDirect({ kind: "open_app", value: appName })
    } else if (name === "open_url") {
      const url = String(args.url ?? "").trim()
      if (url) window.dispatch.runDirect({ kind: "open_url", value: url })
    } else if (name === "dispatch_task") {
      const instruction = String(args.instruction ?? "").trim()
      if (typeof args.label === "string" && args.label.trim() && instruction) {
        pendingLabelsRef.current.push({ instruction, label: args.label.trim() })
      }
      window.dispatch.send(instruction, "voice")
    } else if (name === "amend_task")
      window.dispatch.send(`AMENDMENT to your current/previous task: ${String(args.instruction ?? "")}`, "voice")
    else if (name === "cancel_all") {
      pushToastRef.current("Stopped.", "neutral")
      window.dispatch.interrupt()
    } else if (name === "stop_listening") voiceRef.current.stop()
    return { started: true }
  }

  function toggleMic() {
    if (voice.status === "live" || voice.status === "connecting") voice.stop()
    else if (geminiKey) void voice.start({ apiKey: geminiKey, onTool: onDispatcherTool })
  }

  const voiceIdle = voice.status !== "live" && voice.status !== "connecting"
  const voiceLive = voice.status === "live"

  function toggleDemo() {
    setDemoMode((v) => {
      const next = !v
      localStorage.setItem(DEMO_KEY, next ? "1" : "0")
      return next
    })
  }

  return (
    <div className="relative flex h-screen flex-col bg-[#0a0a0c]">
      <Header
        voiceStatus={voice.status}
        speaking={voice.speaking}
        level={micLevel}
        micEnabled={geminiKey !== null}
        onToggleMic={toggleMic}
        agentStatus={agentStatus}
        agentDetail={agentDetail}
        stopwatch={board.stopwatch}
        permissions={permissions}
        onOpenPermissions={() => setOnboardingOpen(true)}
      />

      {voiceError && (
        <div className="mx-4 mb-1 flex shrink-0 items-center gap-2 rounded-lg border border-red-600/50 bg-red-500/10 px-3 py-2">
          <span className="text-base leading-none text-red-400">⚠</span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-red-200">{voiceError}</span>
          <button
            onClick={() => setOnboardingOpen(true)}
            className="shrink-0 rounded-md bg-red-500/90 px-2.5 py-1 text-xs font-semibold text-black hover:bg-red-400"
          >
            Grant access
          </button>
          <button
            onClick={() => setErrorDismissed(voiceError)}
            aria-label="Dismiss"
            className="shrink-0 px-1 text-sm text-red-300/70 hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {!geminiKey && (
        <div className="mx-4 mb-1 flex shrink-0 gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2">
          <input
            className="flex-1 bg-transparent text-xs text-amber-200 outline-none placeholder:text-amber-200/40"
            placeholder="Paste GEMINI_API_KEY to enable voice (or put it in dispatch/.env)"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <button
            className="text-xs text-amber-300 underline"
            onClick={() => {
              if (!keyDraft.trim()) return
              localStorage.setItem("gemini_key", keyDraft.trim())
              setGeminiKey(keyDraft.trim())
            }}
          >
            save
          </button>
        </div>
      )}

      <Ribbon voiceStatus={voice.status} heard={voice.heard} flashKey={flashKey} />

      <Board cards={board.cards} />

      <Footer
        voiceLive={voiceLive}
        voiceIdle={voiceIdle}
        level={micLevel}
        demoMode={demoMode}
        onSend={(text) => window.dispatch.send(text, "typed")}
        onStopEverything={stopEverything}
        onToggleDemo={toggleDemo}
      />

      <ToastHost toasts={toasts.toasts} />

      {onboardingOpen && (
        <Onboarding
          status={permissions}
          onRefresh={refreshPermissions}
          onDismiss={() => setOnboardingOpen(false)}
          onMicGranted={() => pushToast("Microphone enabled.", "success")}
        />
      )}
    </div>
  )
}
