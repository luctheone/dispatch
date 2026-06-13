import { useCallback, useEffect, useState } from "react"
import type { PermissionState, PermissionStatus } from "../../../shared/types"

// First-run permissions onboarding (supersedes Consent.tsx). A full-window
// overlay shown when the mic isn't granted and the user hasn't dismissed it.
// Pure renderer overlay — it never blocks the headless boot path. Decision is
// driven by ACTUAL mic status, not just the localStorage flag, and re-polls
// getPermissions() on window focus (users grant in System Settings, then return).

export const ONBOARDING_KEY = "dispatch_onboarding_v1"

interface OnboardingProps {
  status: PermissionStatus | null
  // Re-read TCC status (also wired to window focus by the parent).
  onRefresh: () => void
  // Called when the user proceeds (Continue once mic granted, or Skip for now).
  onDismiss: () => void
  // Fired the moment mic flips to "granted" so the parent can toast it.
  onMicGranted?: () => void
}

type EyeRow = {
  key: keyof PermissionStatus
  title: string
  blurb: string
  required: boolean
}

const ROWS: EyeRow[] = [
  {
    key: "microphone",
    title: "Microphone",
    blurb: "Required for voice. Dispatch hears you and acts as you speak.",
    required: true,
  },
  {
    key: "screen",
    title: "Screen Recording",
    blurb: "For computer-use (and VideoDB) — lets Dispatch SEE your screen to click the right things. Restart the app after enabling.",
    required: false,
  },
  {
    key: "accessibility",
    title: "Accessibility",
    blurb: "For computer-use — lets Dispatch move the cursor, click, and type for you. Grant once; restart the app after.",
    required: false,
  },
  {
    key: "automation",
    title: "Automation",
    blurb: "Only for scripting specific apps. Prompts the first time it's needed.",
    required: false,
  },
]

function StateBadge({ state }: { state: PermissionState }) {
  if (state === "granted")
    return <span className="text-sm font-semibold text-emerald-400">✓ granted</span>
  if (state === "denied" || state === "restricted")
    return <span className="text-sm font-semibold text-red-400">✗ {state}</span>
  if (state === "will-prompt")
    return <span className="text-sm font-medium text-zinc-400">will prompt</span>
  if (state === "not-determined")
    return <span className="text-sm font-medium text-zinc-400">• not set</span>
  return <span className="text-sm font-medium text-zinc-500">{state}</span>
}

export default function Onboarding({ status, onRefresh, onDismiss, onMicGranted }: OnboardingProps) {
  const [busy, setBusy] = useState<keyof PermissionStatus | null>(null)
  const [wasGranted, setWasGranted] = useState(status?.microphone === "granted")

  const mic = status?.microphone ?? "unknown"
  const micGranted = mic === "granted"
  const stateOf = (key: keyof PermissionStatus): PermissionState =>
    status?.[key] ?? (key === "automation" ? "will-prompt" : "unknown")

  // Re-poll on window focus — the System Settings round-trip lands here.
  useEffect(() => {
    const onFocus = () => onRefresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [onRefresh])

  // Toast once when mic transitions into granted (e.g. after the OS prompt).
  useEffect(() => {
    if (micGranted && !wasGranted) {
      setWasGranted(true)
      onMicGranted?.()
    } else if (!micGranted && wasGranted) {
      setWasGranted(false)
    }
  }, [micGranted, wasGranted, onMicGranted])

  const requestMic = useCallback(async () => {
    setBusy("microphone")
    try {
      await window.dispatch.requestMic()
    } finally {
      onRefresh()
      setBusy(null)
    }
  }, [onRefresh])

  const requestScreen = useCallback(async () => {
    setBusy("screen")
    try {
      await window.dispatch.requestScreen()
    } finally {
      onRefresh()
      setBusy(null)
    }
  }, [onRefresh])

  const requestAccessibility = useCallback(async () => {
    setBusy("accessibility")
    try {
      await window.dispatch.requestAccessibility()
    } finally {
      onRefresh()
      setBusy(null)
    }
  }, [onRefresh])

  function action(key: keyof PermissionStatus): React.ReactNode {
    const state = stateOf(key)

    if (key === "microphone") {
      if (state === "granted") return null
      return (
        <button
          onClick={requestMic}
          disabled={busy === "microphone"}
          className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-black transition-colors hover:bg-orange-400 disabled:opacity-60"
        >
          {busy === "microphone" ? "Requesting…" : "Allow"}
        </button>
      )
    }

    if (key === "screen") {
      if (state === "granted") return null
      return (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={requestScreen}
            disabled={busy === "screen"}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white disabled:opacity-60"
          >
            {busy === "screen" ? "Prompting…" : "Request"}
          </button>
          <button
            onClick={() => window.dispatch.openScreenSettings()}
            className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            Open Settings
          </button>
        </div>
      )
    }

    if (key === "accessibility") {
      if (state === "granted") return null
      return (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={requestAccessibility}
            disabled={busy === "accessibility"}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white disabled:opacity-60"
          >
            {busy === "accessibility" ? "Prompting…" : "Grant"}
          </button>
        </div>
      )
    }

    // automation
    return (
      <button
        onClick={() => window.dispatch.openAutomationSettings()}
        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
      >
        Open Settings
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0c]/95 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0a0a0c] p-7 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Enable Claude Dispatch</h2>
        </div>

        <p className="text-[15px] leading-relaxed text-zinc-300">
          Dispatch acts on your Mac the moment it understands you — files, commands, and apps. With VideoDB it can also
          watch your screen and act on what it sees. There's no extra confirmation step; stop it any time with{" "}
          <span className="font-semibold text-zinc-100">Stop Everything</span> or{" "}
          <span className="font-semibold text-zinc-100">Esc</span>.
        </p>

        <div className="my-5 space-y-2.5">
          {ROWS.map((row) => {
            const state = stateOf(row.key)
            return (
              <div
                key={row.key}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-zinc-100">{row.title}</h3>
                    {row.required && (
                      <span className="rounded-full border border-orange-500/50 bg-orange-500/10 px-1.5 py-px text-[10px] font-bold tracking-wider text-orange-400">
                        REQUIRED
                      </span>
                    )}
                  </div>
                  <StateBadge state={state} />
                </div>
                <p className="mt-1 text-[13px] leading-snug text-zinc-500">{row.blurb}</p>
                {action(row.key) && <div className="mt-2.5 flex justify-end">{action(row.key)}</div>}
              </div>
            )
          })}
        </div>

        <button
          onClick={() => {
            localStorage.setItem(ONBOARDING_KEY, "1")
            onDismiss()
          }}
          disabled={!micGranted}
          className="w-full rounded-xl bg-orange-500 px-4 py-3 text-base font-semibold text-black transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {micGranted ? "Continue" : "Allow the microphone to continue"}
        </button>
        <button
          onClick={() => {
            localStorage.setItem(ONBOARDING_KEY, "1")
            onDismiss()
          }}
          className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Skip for now — type commands instead
        </button>
      </div>
    </div>
  )
}
