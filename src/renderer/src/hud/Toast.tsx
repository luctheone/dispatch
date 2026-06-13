import { useCallback, useRef, useState } from "react"

// A tiny transient toast stack, bottom-center, ~2.5s auto-dismiss, stacked.
// App drives it via the useToasts() hook: { toasts, push } + a <ToastHost/> it
// renders. Kept dependency-free so any zone can fire feedback without prop drift.

export type ToastTone = "neutral" | "success" | "error"

export interface Toast {
  id: number
  message: string
  tone: ToastTone
  leaving: boolean
}

const VISIBLE_MS = 2500
const LEAVE_MS = 220
const MAX_STACK = 4

export interface ToastApi {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone) => void
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
      setTimeout(() => remove(id), LEAVE_MS)
    },
    [remove],
  )

  const push = useCallback(
    (message: string, tone: ToastTone = "neutral") => {
      const id = nextId.current++
      setToasts((list) => [...list, { id, message, tone, leaving: false }].slice(-MAX_STACK))
      setTimeout(() => dismiss(id), VISIBLE_MS)
    },
    [dismiss],
  )

  return { toasts, push }
}

const toneClass: Record<ToastTone, string> = {
  neutral: "border-zinc-700 bg-zinc-900/95 text-zinc-100",
  success: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  error: "border-red-500/55 bg-red-500/15 text-red-200",
}

const toneDot: Record<ToastTone, string> = {
  neutral: "bg-zinc-400",
  success: "bg-emerald-400",
  error: "bg-red-400",
}

export function ToastHost({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex flex-col items-center gap-1.5 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-xl backdrop-blur ${
            t.leaving ? "toast-out" : "toast-in"
          } ${toneClass[t.tone]}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[t.tone]}`} />
          {t.message}
        </div>
      ))}
    </div>
  )
}
