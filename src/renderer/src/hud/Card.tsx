import { useEffect, useRef, useState } from "react"
import { fallbackLabel, type Card as CardModel, type CardStatus } from "./cards"
import { playChime } from "./chime"

const FLASH_MS = 700

function seconds(fromMs: number, toMs: number): string {
  return `${((toMs - fromMs) / 1000).toFixed(1)}s`
}

function StatusChip({ status }: { status: CardStatus }) {
  const byStatus: Record<CardStatus, string> = {
    QUEUED: "border-zinc-700 text-zinc-400",
    ACTING: "animate-pulse border-orange-500/60 bg-orange-500/10 text-orange-400",
    DONE: "border-emerald-500/60 bg-emerald-500/10 text-emerald-400",
    CANCELLED: "border-red-500/60 bg-red-500/10 text-red-400",
  }
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${byStatus[status]}`}
    >
      {status}
    </span>
  )
}

const EyeGlyph = ({ className }: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
  </svg>
)

export function AmendmentGraft({ card }: { card: CardModel }) {
  const cancelled = card.status === "CANCELLED"
  return (
    <div
      className={`card-enter ml-5 rounded-r-lg border-l-2 py-1.5 pl-3 pr-2 ${
        cancelled ? "border-red-500 bg-red-500/5" : "border-orange-500 bg-orange-500/[0.07]"
      }`}
    >
      <span className={`mr-2 text-[10px] font-bold tracking-wider ${cancelled ? "text-red-400" : "text-orange-400"}`}>
        AMENDMENT
      </span>
      <span className={`text-sm ${cancelled ? "text-red-400/70 line-through" : "text-orange-200/90"}`}>
        {card.instruction.replace(/^AMENDMENT( to your current\/previous task:)?\s*/i, "")}
      </span>
    </div>
  )
}

export default function Card({ card, grafts }: { card: CardModel; grafts: CardModel[] }) {
  const [doneFlash, setDoneFlash] = useState(false)
  const prevStatus = useRef<CardStatus>(card.status)

  useEffect(() => {
    const was = prevStatus.current
    prevStatus.current = card.status
    if (card.status === "DONE" && was !== "DONE") {
      playChime()
      setDoneFlash(true)
      const t = setTimeout(() => setDoneFlash(false), FLASH_MS)
      return () => clearTimeout(t)
    }
    return undefined
  }, [card.status])

  const cancelled = card.status === "CANCELLED"
  const isVision = card.source === "vision"

  const border = cancelled
    ? "border-red-500/50"
    : card.status === "ACTING"
      ? "border-orange-500/40"
      : card.status === "DONE"
        ? "border-emerald-500/30"
        : "border-zinc-800"

  // Vision cards (it acted on what it SAW) get a distinct indigo left edge + tint
  // that survives the status border so the eeriest beat reads clearly.
  const visionWrap = isVision ? "border-l-4 border-l-indigo-500 bg-indigo-500/[0.07]" : "bg-zinc-900/60"

  return (
    <div className="space-y-1.5">
      <div
        className={`rounded-xl border px-4 py-3 transition-colors duration-300 ${border} ${visionWrap} ${
          isVision ? "vision-enter" : "card-enter"
        } ${doneFlash ? "done-flash !border-emerald-400" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            className={`flex items-center gap-2 text-lg font-semibold leading-tight ${
              cancelled ? "text-red-400/80 line-through" : "text-zinc-100"
            }`}
          >
            {isVision && (
              <span className="shrink-0 text-indigo-300" aria-label="saw this">
                <EyeGlyph className="inline-block align-[-2px]" />
              </span>
            )}
            {card.label ?? fallbackLabel(card.instruction)}
          </h3>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {isVision && (
              <span className="flex items-center gap-1 rounded-full border border-indigo-400/60 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-indigo-300">
                <EyeGlyph className="h-3 w-3" />
                SAW THIS
              </span>
            )}
            {card.amended && (
              <span className="rounded-full border border-orange-500/60 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-orange-400">
                AMENDED
              </span>
            )}
            <StatusChip status={card.status} />
          </div>
        </div>

        <p className={`mt-1 text-sm leading-snug ${cancelled ? "text-red-400/50 line-through" : "text-zinc-500"}`}>
          {card.instruction}
        </p>

        {card.tools.length > 0 && (
          <div className="mt-2 space-y-1 border-l border-zinc-800 pl-3">
            {card.tools.map((t, i) => (
              <div key={i} className="flex items-baseline gap-2 font-mono text-xs leading-snug">
                <span className={t.vision ? "text-indigo-300" : t.liveWeb ? "text-purple-300" : "text-zinc-400"}>
                  {t.name}
                  {t.summary ? ` — ${t.summary}` : ""}
                </span>
                {t.vision && (
                  <span className="shrink-0 rounded border border-indigo-400/60 bg-indigo-500/10 px-1 py-px text-[9px] font-bold tracking-wider text-indigo-300">
                    VIDEO
                  </span>
                )}
                {t.liveWeb && (
                  <span className="shrink-0 rounded border border-purple-500/60 bg-purple-500/10 px-1 py-px text-[9px] font-bold tracking-wider text-purple-300">
                    LIVE WEB
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {card.doneLine && <p className="mt-2 text-sm font-medium text-emerald-400">{card.doneLine}</p>}

        {card.status === "DONE" && card.doneAt !== null && (
          <p className="mt-2 text-[13px] font-medium tabular-nums text-zinc-300">
            heard → acting: <span className="text-orange-400">{seconds(card.at, card.actingAt ?? card.doneAt)}</span>
            {" · "}done: <span className="text-emerald-400">{seconds(card.at, card.doneAt)}</span>
            {card.doneWhileTalking && <span className="text-zinc-500"> — you were still talking</span>}
          </p>
        )}
      </div>

      {grafts.map((g) => (
        <AmendmentGraft key={g.id} card={g} />
      ))}
    </div>
  )
}
