import { useEffect, useRef, useState } from "react"
import type { VoiceStatus } from "../../../shared/types"

const FLASH_CHARS = 40
const FLASH_MS = 700

interface RibbonProps {
  voiceStatus: VoiceStatus
  heard: string
  flashKey: number // increments on each dispatch → flash the latest words orange
}

export default function Ribbon({ voiceStatus, heard, flashKey }: RibbonProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [flashing, setFlashing] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [heard])

  useEffect(() => {
    if (flashKey === 0) return
    setFlashing(true)
    const t = setTimeout(() => setFlashing(false), FLASH_MS)
    return () => clearTimeout(t)
  }, [flashKey])

  if (voiceStatus === "idle" || voiceStatus === "unsupported") return null

  const cut = Math.max(0, heard.length - FLASH_CHARS)
  const head = heard.slice(0, cut)
  const tail = heard.slice(cut)

  return (
    <div className="mx-4 mb-1 h-16 shrink-0 overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900/40">
      <div ref={scrollRef} className="fade-top h-full overflow-y-hidden px-3 py-1.5">
        {heard ? (
          <p className="text-[15px] leading-snug text-zinc-500">
            {head}
            <span className={`transition-colors duration-200 ${flashing ? "font-semibold text-orange-400" : ""}`}>
              {tail}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-[15px] leading-snug text-zinc-600">
            {voiceStatus === "connecting" ? (
              "Connecting mic…"
            ) : (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
                Listening — speak and I dispatch as you go.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
