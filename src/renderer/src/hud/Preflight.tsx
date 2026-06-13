import { useEffect, useState } from "react"
import type { PreflightResult } from "../../../shared/types"

type RowState = "ok" | "fail" | "skip"

function Verdict({ state, revealed }: { state: RowState | null; revealed: boolean }) {
  if (!revealed || state === null) {
    return <span className="text-sm text-zinc-600">…</span>
  }
  if (state === "ok") return <span className="text-base font-bold text-emerald-400">✓</span>
  if (state === "fail") return <span className="text-base font-bold text-red-400">✗</span>
  return <span className="text-xs font-medium text-zinc-500">skip</span>
}

interface PreflightProps {
  open: boolean
  level: number // live mic RMS 0..1
}

export default function Preflight({ open, level }: PreflightProps) {
  const [result, setResult] = useState<PreflightResult | null>(null)
  const [revealed, setRevealed] = useState(0)

  useEffect(() => {
    if (!open) {
      setResult(null)
      setRevealed(0)
      return
    }
    let alive = true
    window.dispatch
      .preflight()
      .then((r) => {
        if (alive) setResult(r)
      })
      .catch(() => {
        if (alive) setResult({ gemini: "fail", agent: "fail", brightdata: "fail", videodb: "fail" })
      })
    const timers = [1, 2, 3, 4, 5].map((i) => setTimeout(() => setRevealed(i), 180 * i))
    return () => {
      alive = false
      timers.forEach(clearTimeout)
    }
  }, [open])

  if (!open) return null

  const rows: Array<{ name: string; state: RowState | null }> = [
    { name: "Gemini", state: result?.gemini ?? null },
    { name: "Agent", state: result?.agent ?? null },
    { name: "Bright Data", state: result?.brightdata ?? null },
    { name: "VideoDB (eyes)", state: result?.videodb ?? null },
  ]

  const rms = Math.min(1, level)

  return (
    <div className="slide-up absolute bottom-full left-0 right-0 z-10 mx-4 mb-2 rounded-2xl border border-zinc-700 bg-[#101014] p-3 shadow-2xl">
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Preflight</div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div
            key={row.name}
            className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/70 px-3 py-2"
          >
            <span className="text-sm font-medium text-zinc-300">{row.name}</span>
            <Verdict state={row.state} revealed={revealed > i} />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/70 px-3 py-2">
          <span className="shrink-0 text-sm font-medium text-zinc-300">Mic</span>
          {revealed > 4 ? (
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all duration-100 ${rms > 0.02 ? "bg-emerald-400" : "bg-zinc-600"}`}
                style={{ width: `${Math.max(3, rms * 100)}%` }}
              />
            </div>
          ) : (
            <span className="text-sm text-zinc-600">…</span>
          )}
        </div>
      </div>
    </div>
  )
}
