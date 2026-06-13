import type { AgentEvent, DispatchSource } from "../../../shared/types"

// Card model + pure reducer for the dispatch board. One card per
// {kind:'dispatched'} event, keyed by the main-process-assigned id.
// Lifecycle: QUEUED → ACTING → DONE | CANCELLED (+ AMENDED tag).

export type CardStatus = "QUEUED" | "ACTING" | "DONE" | "CANCELLED"

export interface ToolLine {
  name: string
  summary: string
  at: number
  liveWeb: boolean // name starts with "mcp__brightdata" → purple + LIVE WEB tag
  vision: boolean // name starts with "mcp__videodb" → vision purple + VIDEO tag
}

export interface Card {
  id: number
  instruction: string
  label: string | null // TokenRouter fast-lane label; may never arrive
  source: DispatchSource // where the dispatch came from; "vision" gets the eye/purple treatment
  at: number // dispatched timestamp
  actingAt: number | null
  doneAt: number | null
  status: CardStatus
  amended: boolean // an amendment graft is attached to this card
  isAmendment: boolean // renders as a slim orange graft, not a full card
  parentId: number | null // graft parent; null = standalone amendment
  tools: ToolLine[]
  doneLine: string | null // the agent's "✓ ..." attribution line
  doneWhileTalking: boolean // voice was live at doneAt → "you were still talking"
}

export interface Stopwatch {
  startedAt: number
  frozenMs: number | null // null = running; set on first tool after startedAt
}

export interface BoardState {
  cards: Card[]
  stopwatch: Stopwatch | null
}

export interface BoardAction {
  event: AgentEvent
  voiceLive: boolean // voice status was "live" when the event arrived
}

export const initialBoard: BoardState = { cards: [], stopwatch: null }

const AMENDMENT_PREFIX = /^AMENDMENT(\s+to\s+your\s+current\/previous\s+task:)?\s*/i

export function fallbackLabel(instruction: string): string {
  const words = instruction
    .replace(AMENDMENT_PREFIX, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function isLive(c: Card): boolean {
  return c.status === "QUEUED" || c.status === "ACTING"
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  const e = action.event

  switch (e.kind) {
    case "dispatched": {
      // Stopwatch: start on dispatch when none is running (null or frozen).
      const stopwatch =
        state.stopwatch === null || state.stopwatch.frozenMs !== null
          ? { startedAt: e.at, frozenMs: null }
          : state.stopwatch

      const isAmendment = e.text.trimStart().startsWith("AMENDMENT")
      let parentId: number | null = null
      let cards = state.cards

      if (isAmendment) {
        // Graft under the most recent card still in flight (not DONE/CANCELLED,
        // not itself a graft); standalone if none.
        const parent = [...cards].reverse().find((c) => !c.isAmendment && isLive(c))
        if (parent) {
          parentId = parent.id
          cards = cards.map((c) => (c.id === parent.id ? { ...c, amended: true } : c))
        }
      }

      const card: Card = {
        id: e.id,
        instruction: e.text,
        label: null,
        source: e.source ?? "typed",
        at: e.at,
        actingAt: null,
        doneAt: null,
        status: "QUEUED",
        amended: false,
        isAmendment,
        parentId,
        tools: [],
        doneLine: null,
        doneWhileTalking: false,
      }
      return { cards: [...cards, card], stopwatch }
    }

    case "label": {
      return {
        ...state,
        cards: state.cards.map((c) => (c.id === e.id ? { ...c, label: e.label } : c)),
      }
    }

    case "tool": {
      // Freeze the stopwatch on the first tool after its start.
      const stopwatch =
        state.stopwatch !== null && state.stopwatch.frozenMs === null && e.at > state.stopwatch.startedAt
          ? { ...state.stopwatch, frozenMs: e.at - state.stopwatch.startedAt }
          : state.stopwatch

      // Promote the oldest QUEUED (non-graft) card dispatched before this tool.
      let cards = state.cards
      const queued = cards.find((c) => !c.isAmendment && c.status === "QUEUED" && c.at < e.at)
      if (queued) {
        cards = cards.map((c) => (c.id === queued.id ? { ...c, status: "ACTING" as const, actingAt: e.at } : c))
      }

      // The tool line belongs to the card currently being worked: oldest ACTING.
      const acting = cards.find((c) => !c.isAmendment && c.status === "ACTING")
      if (acting) {
        const line: ToolLine = {
          name: e.name,
          summary: e.summary,
          at: e.at,
          liveWeb: e.name.startsWith("mcp__brightdata"),
          vision: e.name.startsWith("mcp__videodb"),
        }
        cards = cards.map((c) => (c.id === acting.id ? { ...c, tools: [...c.tools, line] } : c))
      }
      return { cards, stopwatch }
    }

    case "text": {
      // "✓ ..." marks the oldest ACTING card DONE.
      if (!e.text.trimStart().startsWith("✓")) return state
      const acting = state.cards.find((c) => !c.isAmendment && c.status === "ACTING")
      if (!acting) return state
      const line = e.text.split("\n").find((l) => l.trimStart().startsWith("✓")) ?? e.text
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === acting.id
            ? {
                ...c,
                status: "DONE" as const,
                doneAt: e.at,
                doneLine: line.trim(),
                doneWhileTalking: action.voiceLive,
              }
            : c,
        ),
      }
    }

    case "turn_done": {
      // ACTING cards complete unconditionally. QUEUED cards (e.g. answered
      // with text only, no tool call) complete only if dispatched >1.5s ago —
      // a dispatch landing during the turn's final response is queued by the
      // CLI for the NEXT turn and must stay live so its tools attribute.
      // A still-running stopwatch (no tool ever froze it) resets here, or the
      // next dispatch would inherit a stale startedAt and freeze at e.g. 47s.
      const stopwatch = state.stopwatch && state.stopwatch.frozenMs === null ? null : state.stopwatch
      return {
        stopwatch,
        cards: state.cards.map((c) =>
          c.status === "ACTING" || (c.status === "QUEUED" && e.at - c.at > 1500)
            ? { ...c, status: "DONE" as const, doneAt: e.at, doneWhileTalking: action.voiceLive }
            : c,
        ),
      }
    }

    case "cancelled": {
      const stopwatch = state.stopwatch && state.stopwatch.frozenMs === null ? null : state.stopwatch
      return {
        stopwatch,
        cards: state.cards.map((c) => (isLive(c) ? { ...c, status: "CANCELLED" as const } : c)),
      }
    }

    default:
      return state
  }
}
