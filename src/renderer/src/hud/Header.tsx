import { useEffect, useRef, useState } from "react"
import type { PermissionStatus, VoiceStatus } from "../../../shared/types"
import type { Stopwatch } from "./cards"

export type AgentStatus = "starting" | "ready" | "working" | "idle" | "error"

interface HeaderProps {
  voiceStatus: VoiceStatus
  speaking: boolean
  level: number
  micEnabled: boolean // a Gemini key is present (voice is usable at all)
  onToggleMic: () => void
  agentStatus: AgentStatus
  agentDetail: string | null
  stopwatch: Stopwatch | null
  permissions: PermissionStatus | null
  onOpenPermissions: () => void
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

function StopwatchView({ stopwatch }: { stopwatch: Stopwatch | null }) {
  const [, setTick] = useState(0)
  const [freezeKey, setFreezeKey] = useState(0)
  const wasFrozen = useRef(false)

  const running = stopwatch !== null && stopwatch.frozenMs === null
  const frozen = stopwatch !== null && stopwatch.frozenMs !== null

  useEffect(() => {
    if (!running) return
    let raf = 0
    const loop = () => {
      setTick((t) => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running])

  // Snap-shut animation the instant the watch freezes on the first tool.
  useEffect(() => {
    if (frozen && !wasFrozen.current) {
      wasFrozen.current = true
      setFreezeKey((k) => k + 1)
    } else if (!frozen) {
      wasFrozen.current = false
    }
  }, [frozen])

  if (!stopwatch) {
    return <div className="text-[2rem] font-light leading-none tabular-nums tracking-tight text-zinc-700">0.00s</div>
  }
  if (stopwatch.frozenMs !== null) {
    return (
      <div
        key={freezeKey}
        className="stopwatch-freeze text-[2rem] font-bold leading-none tabular-nums tracking-tight text-orange-400"
      >
        {formatMs(stopwatch.frozenMs)}
      </div>
    )
  }
  return (
    <div className="text-[2rem] font-medium leading-none tabular-nums tracking-tight text-zinc-100">
      {formatMs(Math.max(0, Date.now() - stopwatch.startedAt))}
    </div>
  )
}

function MicOrb({
  status,
  speaking,
  level,
  enabled,
  onToggle,
}: {
  status: VoiceStatus
  speaking: boolean
  level: number
  enabled: boolean
  onToggle: () => void
}) {
  const disabled = !enabled && (status === "idle" || status === "unsupported")
  const base =
    "relative flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-200"

  // Every state is legible against #0a0a0c — never near-invisible.
  const byStatus: Record<VoiceStatus, string> = {
    idle: "border-zinc-500 bg-zinc-800 hover:border-orange-400/70 hover:bg-zinc-700",
    connecting: "animate-pulse border-amber-400 bg-amber-500/30",
    live: "border-orange-300 bg-orange-500 shadow-[0_0_20px_rgba(251,146,60,0.5)]",
    error: "border-red-500 bg-red-500/30 shadow-[0_0_14px_rgba(239,68,68,0.4)]",
    unsupported: "border-red-500 bg-red-500/30",
  }

  const title = disabled
    ? "Add a Gemini key to enable voice"
    : status === "live"
      ? "Listening — tap to stop"
      : status === "connecting"
        ? "Connecting…"
        : status === "error" || status === "unsupported"
          ? "Voice error — tap to retry"
          : "Tap to talk"

  const iconColor =
    status === "live"
      ? "text-black"
      : status === "error" || status === "unsupported"
        ? "text-red-300"
        : status === "connecting"
          ? "text-amber-200"
          : "text-zinc-200"

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`${base} ${byStatus[status]} ${disabled ? "opacity-45" : ""}`}
    >
      {/* Idle hint ring so the orb always reads as tappable. */}
      {status === "idle" && !disabled && <span className="orb-idle-ring" />}
      {status === "live" && (
        <span
          className="orb-ring"
          style={{ transform: `scale(${1 + Math.min(1, level) * 1.1})`, opacity: 0.25 + Math.min(1, level) * 0.6 }}
        />
      )}
      <svg viewBox="0 0 24 24" className={`h-5 w-5 ${iconColor}`} fill="currentColor">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2Z" />
      </svg>

      {/* Error glyph — unmistakable. */}
      {(status === "error" || status === "unsupported") && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#0a0a0c] bg-red-500 text-[9px] font-black leading-none text-white">
          !
        </span>
      )}
      {/* Dispatcher's own voice. */}
      {speaking && status !== "error" && status !== "unsupported" && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0a0a0c] bg-white" />
      )}
    </button>
  )
}

const agentLabel: Record<AgentStatus, string> = {
  starting: "starting",
  ready: "ready",
  working: "working",
  idle: "ready",
  error: "error",
}

export default function Header({
  voiceStatus,
  speaking,
  level,
  micEnabled,
  onToggleMic,
  agentStatus,
  agentDetail,
  stopwatch,
  permissions,
  onOpenPermissions,
}: HeaderProps) {
  const dotClass: Record<AgentStatus, string> = {
    ready: "bg-emerald-400",
    idle: "bg-emerald-400",
    working: "bg-orange-400 animate-pulse",
    error: "bg-red-500",
    starting: "bg-zinc-600 animate-pulse",
  }

  // Surface a permissions affordance whenever something the user expects isn't
  // granted yet (mic blocking is the urgent one).
  const needsPerms =
    permissions !== null &&
    (permissions.microphone !== "granted" || permissions.screen !== "granted")
  const micBlocked = permissions !== null && permissions.microphone !== "granted"

  return (
    <header className="drag flex items-center gap-3 px-4 pb-3 pt-4 pl-16">
      <div className="no-drag">
        <MicOrb status={voiceStatus} speaking={speaking} level={level} enabled={micEnabled} onToggle={onToggleMic} />
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass[agentStatus]}`} />
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-300">{agentLabel[agentStatus]}</span>
        </div>
        {agentDetail && <span className="truncate text-[11px] text-zinc-600">{agentDetail}</span>}
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        {needsPerms && (
          <button
            onClick={onOpenPermissions}
            title="Review permissions"
            className={`no-drag flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${
              micBlocked
                ? "border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
            }`}
          >
            <span className="text-xs leading-none">⚠</span>
            permissions
          </button>
        )}
        <StopwatchView stopwatch={stopwatch} />
      </div>
    </header>
  )
}
