import { useEffect, useRef } from "react"
import Card, { AmendmentGraft } from "./Card"
import type { Card as CardModel } from "./cards"

export default function Board({ cards }: { cards: CardModel[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [cards])

  const graftsByParent = new Map<number, CardModel[]>()
  for (const c of cards) {
    if (c.isAmendment && c.parentId !== null) {
      const list = graftsByParent.get(c.parentId) ?? []
      list.push(c)
      graftsByParent.set(c.parentId, list)
    }
  }

  return (
    <main className="flex-1 space-y-2.5 overflow-y-auto px-4 py-2">
      {cards.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60 text-zinc-600">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M19 11a7 7 0 0 1-14 0" strokeLinecap="round" />
              <path d="M12 18v3" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-base font-medium leading-relaxed text-zinc-400">Speak or type</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">Dispatch acts as you talk.</p>
        </div>
      )}
      {cards.map((c) => {
        if (c.isAmendment) {
          // Grafts with a parent render under that parent's card.
          if (c.parentId !== null) return null
          return <AmendmentGraft key={c.id} card={c} />
        }
        return <Card key={c.id} card={c} grafts={graftsByParent.get(c.id) ?? []} />
      })}
      <div ref={bottomRef} />
    </main>
  )
}
