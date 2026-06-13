import { useEffect, useRef, useState } from "react"
import Preflight from "./Preflight"

interface FooterProps {
  voiceLive: boolean // voice is currently listening
  voiceIdle: boolean // voice is not live/connecting (input gets focus)
  level: number
  demoMode: boolean // REPLAY lives behind this flag; keys 1–5 only work here
  onSend: (text: string) => void
  onStopEverything: () => void
  onToggleDemo: () => void
}

export default function Footer({
  voiceLive,
  voiceIdle,
  level,
  demoMode,
  onSend,
  onStopEverything,
  onToggleDemo,
}: FooterProps) {
  const [input, setInput] = useState("")
  const [preflightOpen, setPreflightOpen] = useState(false)
  const [braking, setBraking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (voiceIdle) inputRef.current?.focus()
  }, [voiceIdle])

  function submit() {
    const t = input.trim()
    if (!t) return
    onSend(t)
    setInput("")
  }

  function stop() {
    setBraking(true)
    setTimeout(() => setBraking(false), 200)
    onStopEverything()
  }

  return (
    <footer className="relative shrink-0 border-t border-zinc-800/80 px-4 pb-4 pt-3">
      <Preflight open={preflightOpen} level={level} />

      {/* Plain status near the input — no cryptic mode badge. */}
      <div className="mb-2 flex h-4 items-center text-[12px]">
        {voiceLive ? (
          <span className="flex items-center gap-1.5 font-medium text-orange-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
            Listening
          </span>
        ) : (
          <span className="text-zinc-600">Type a command, or tap the mic.</span>
        )}
        {demoMode && (
          <span className="ml-auto text-[11px] font-medium text-purple-300/80">Demo mode — keys 1–5</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-base text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500"
          placeholder="Type a dispatch…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button
          onClick={submit}
          className="shrink-0 rounded-lg bg-orange-500 px-4 py-2.5 text-base font-semibold text-black transition-colors hover:bg-orange-400 active:scale-95"
        >
          Dispatch
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={stop}
          className={`rounded-lg border-2 border-red-500/70 bg-red-500/5 px-3 py-1.5 text-sm font-bold text-red-400 transition-colors hover:bg-red-500/15 ${
            braking ? "brake-press" : ""
          }`}
        >
          Stop Everything
        </button>
        <button
          onClick={() => setPreflightOpen((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            preflightOpen
              ? "border-zinc-500 bg-zinc-800 text-zinc-200"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          Preflight
        </button>
        <button
          onClick={onToggleDemo}
          title="Demo mode — keys 1–5 fire scripted dispatches"
          aria-label="Toggle demo mode"
          className={`ml-auto flex h-8 w-8 items-center justify-center rounded-lg border text-base transition-colors ${
            demoMode
              ? "border-purple-500/60 bg-purple-500/10 text-purple-300"
              : "border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
      </div>
    </footer>
  )
}
