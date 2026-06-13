// The heart of Dispatch: a persistent Claude Agent SDK session with streaming
// input. Spoken clauses are pushed into the RUNNING session the moment they
// are actionable — the agent starts step 1 while you're still explaining
// step 3. Pattern validated in /tmp/dispatch-warm/streaming-test.mjs:
// messages pushed at 0s/3s/8s all executed within a single agent turn.
import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AgentEvent, DispatchSource } from "../shared/types"

const DEDUPE_WINDOW_MS = 3000

const SYSTEM_APPEND = `
You are Claude Dispatch, a hands-on desktop agent driven by LIVE SPEECH.
The user is speaking right now; their instructions arrive as fragments, in
order, possibly while you are mid-task. Rules:
- ACT IMMEDIATELY on each instruction. Never wait to see if more is coming.
- Later fragments may AMEND earlier ones ("actually make it blue") — apply
  the amendment to what you already did rather than asking.
- Never ask clarifying questions unless truly blocked; pick the obvious
  interpretation and state it in a few words.
- Keep every reply to ONE short line (it appears in a small HUD). No lists,
  no markdown, no preamble. Example: "Created notes.md on the Desktop."
- After you finish each instruction, output a single line starting with "✓ "
  naming what happened (e.g. "✓ Created osaka-trip on the Desktop").
- When several instructions are pending, do fast local steps before slow web
  lookups.
- You are on the user's macOS machine. PREFER fast, permission-free actions:
  create/edit files, and use \`open <file>\`, \`open <url>\`, or \`open -a "App"\`
  to show results — that's LaunchServices: instant, no permission prompt.
- DO NOT simulate keystrokes or clicks via osascript/"System Events" — that needs
  the heavy Accessibility permission, is slow, and is usually blocked. To put text
  somewhere, WRITE A FILE and \`open\` it (e.g. write notes.md then open it) rather
  than typing into a GUI app. If the user explicitly wants a specific app, use that
  app's AppleScript dictionary (e.g. Notes: \`make new note with body\`) — that's
  the lighter Automation permission — but NEVER System Events keystroke.
- screencapture is fine for screenshots. Keep every action fast and visible.
- Prefer visible results: \`open\` the file or folder you made or affected.`

export interface RunnerOptions {
  cwd: string
  model?: string
  // Absolute path to the SDK's `claude` binary. Required in the packaged app:
  // with asar enabled the SDK would resolve the binary to a path inside
  // app.asar (a file, not a dir) and spawn fails with ENOTDIR, so main passes
  // the asar.unpacked path. Undefined in dev → the SDK resolves it itself.
  claudeExecutable?: string
  onEvent: (e: AgentEvent) => void
}

export class AgentRunner {
  private queue: SDKUserMessage[] = []
  private closed = false
  private q: Query | null = null
  private opts: RunnerOptions
  private running = false
  private interrupting = false
  private nextId = 1
  private recent: { norm: string; at: number }[] = []

  constructor(opts: RunnerOptions) {
    this.opts = opts
  }

  /** Start the streaming session loop. */
  start() {
    if (this.running) return
    this.running = true
    this.opts.onEvent({ kind: "status", status: "starting" })
    this.run().catch((err) => {
      this.opts.onEvent({ kind: "error", message: String(err?.message ?? err), at: Date.now() })
      this.opts.onEvent({ kind: "status", status: "error", detail: String(err?.message ?? err) })
      this.running = false
    })
  }

  /**
   * Genuinely warm the session at boot. The Agent SDK initializes lazily on the
   * FIRST user message, so without this the status sits at "starting" until you
   * act AND your first real command eats the one-time ~5-8s init. This queues a
   * silent priming message — NO "dispatched" event, so no card appears — which
   * triggers init (status → ready/idle) and leaves the session hot for the first
   * real dispatch. The reducer ignores the priming reply (it's not a "✓" line and
   * there are no cards to attribute it to), so the board stays empty.
   */
  prewarm() {
    if (!this.running) this.start()
    this.queue.push({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Session warm-up ping. Reply with the single word: ready. Use no tools." }],
      },
      parent_tool_use_id: null,
      session_id: "dispatch",
    } as SDKUserMessage)
  }

  dispatch(text: string, source: DispatchSource = "typed") {
    const trimmed = text.trim()
    if (!trimmed) return
    const at = Date.now()
    // Gemini double-fire guard: drop instructions identical (case/whitespace-
    // insensitive) to one dispatched within the last 3s. Also coalesces a
    // VideoDB alert that re-fires on consecutive frames into a single dispatch.
    const norm = trimmed.toLowerCase().replace(/\s+/g, " ")
    this.recent = this.recent.filter((r) => at - r.at < DEDUPE_WINDOW_MS)
    if (this.recent.some((r) => r.norm === norm)) {
      console.log("[dispatch] dropped duplicate instruction:", trimmed)
      return
    }
    this.recent.push({ norm, at })

    const id = this.nextId++
    this.opts.onEvent({ kind: "dispatched", id, text: trimmed, at, source })
    this.requestLabel(id, trimmed)
    this.queue.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: trimmed }] },
      parent_tool_use_id: null,
      session_id: "dispatch",
    } as SDKUserMessage)
    if (!this.running) this.start()
  }

  /** Stop everything: clear pending queue and interrupt the running turn. */
  async interrupt() {
    // The interrupted turn's `result` races the interrupt ack on the message
    // stream; if it wins, the run loop would emit turn_done and the HUD would
    // flash cards green-DONE (+ chime) on the panic button. The flag makes the
    // loop swallow that one result; the 2s fallback clears it if none arrives.
    this.interrupting = true
    this.queue.length = 0
    try {
      await this.q?.interrupt()
    } catch {}
    this.opts.onEvent({ kind: "cancelled", at: Date.now() })
    this.opts.onEvent({ kind: "status", status: "idle" })
    setTimeout(() => {
      this.interrupting = false
    }, 2000)
  }

  /** Quietly drop the newest QUEUED (not yet running) instruction. */
  cancelLast() {
    if (this.queue.length > 0) {
      this.queue.splice(this.queue.length - 1, 1)
      console.log("[dispatch] cancelLast removed newest queued instruction")
    }
  }

  async stop() {
    this.closed = true
    try {
      await this.q?.interrupt()
    } catch {}
  }

  // TokenRouter fast lane (sponsor): fire-and-forget 3-4 word card labels.
  // Must NEVER block or delay dispatch — plain fetch, 2.5s budget, any
  // failure is silent (the HUD renders a truncated-instruction fallback).
  private requestLabel(id: number, instruction: string) {
    const key = process.env.TOKENROUTER_API_KEY
    if (!key) return
    const base = process.env.TOKENROUTER_BASE_URL || "https://api.tokenrouter.io/v1"
    void fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.TOKENROUTER_MODEL || "auto",
        max_tokens: 12,
        messages: [
          {
            role: "user",
            content: `Reply with ONLY a 3-4 word Title Case label for this task, no punctuation: ${instruction}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(2500),
    })
      .then(async (res) => {
        if (!res.ok) return
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        const label = data.choices?.[0]?.message?.content?.trim()
        if (label) this.opts.onEvent({ kind: "label", id, label })
      })
      .catch(() => {})
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.queue.shift()
      if (next) yield next
      else await new Promise((r) => setTimeout(r, 25))
    }
  }

  private async run() {
    // Sponsor integrations (Agent Forge judging criterion: "sponsored product usage").
    // The Agent SDK speaks MCP natively, so each "eyes/hands" integration is
    // config, not code.
    type McpStdioServer = { command: string; args: string[]; env?: Record<string, string> }
    const mcpServers: Record<string, McpStdioServer> = {}

    // MCP servers connect during the agent's session init and BLOCK the "ready"
    // event until their handshake completes — so a stalled network call or a
    // broken package hangs the whole agent, not just one beat (observed: a
    // disk-truncated Bright Data install hung boot for 70s+). The core
    // speak->act loop is the demo's spine and must boot fast every time, so MCP
    // is OPT-IN: set DISPATCH_MCP=on only after pre-warming on the demo network.
    // (VideoDB "vision" Path B via the webhook receiver is pure Node — always on,
    // never gates boot.)
    const mcpEnabled = process.env.DISPATCH_MCP === "on"

    // Bright Data's official MCP server gives the agent live web access.
    const brightDataToken = process.env.BRIGHTDATA_API_TOKEN
    if (mcpEnabled && brightDataToken) {
      mcpServers.brightdata = {
        command: "npx",
        args: ["-y", "@brightdata/mcp"],
        env: { API_TOKEN: brightDataToken },
      }
    }

    // VideoDB MCP server — the agent's "eyes" as a TOOL (Path A): it can pull a
    // scene, search a clip, or read what's on a stream on demand. VideoDB ships
    // only a Python package (videodb-director-mcp); `uvx` runs it without a
    // pre-install. The key is passed via the documented --api-key flag and also
    // mirrored into env for robustness across package versions.
    const videoDbKey = process.env.VIDEODB_API_KEY
    if (mcpEnabled && videoDbKey) {
      mcpServers.videodb = {
        command: "uvx",
        args: ["videodb-director-mcp@latest", `--api-key=${videoDbKey}`],
        env: { VIDEODB_API_KEY: videoDbKey, VIDEO_DB_API_KEY: videoDbKey },
      }
    }
    if (mcpEnabled) console.log("[dispatch] MCP servers enabled:", Object.keys(mcpServers).join(", ") || "(none — no keys)")

    const hasMcp = Object.keys(mcpServers).length > 0

    // Kimi k2.6 executor mode: Moonshot exposes an Anthropic-compatible
    // endpoint, so DISPATCH_EXECUTOR=kimi retargets the whole agent loop.
    const kimiMode = process.env.DISPATCH_EXECUTOR === "kimi" && process.env.KIMI_API_KEY
    const env = kimiMode
      ? {
          ...(process.env as Record<string, string>),
          ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
          ANTHROPIC_AUTH_TOKEN: process.env.KIMI_API_KEY!,
        }
      : undefined

    this.q = query({
      prompt: this.input(),
      options: {
        cwd: this.opts.cwd,
        model: kimiMode ? "kimi-k2.6" : this.opts.model,
        permissionMode: "bypassPermissions",
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        includePartialMessages: true,
        // Counts API round-trips CUMULATIVELY over this persistent session —
        // a 3pm rehearsal plus the live demo share the budget. Keep it high.
        maxTurns: 1000,
        ...(this.opts.claudeExecutable ? { pathToClaudeCodeExecutable: this.opts.claudeExecutable } : {}),
        ...(hasMcp ? { mcpServers } : {}),
        ...(env ? { env } : {}),
      },
    })

    for await (const msg of this.q) {
      const at = Date.now()
      if (msg.type === "system" && msg.subtype === "init") {
        this.opts.onEvent({ kind: "status", status: "ready", detail: msg.model })
      } else if (msg.type === "stream_event") {
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          this.opts.onEvent({ kind: "text_delta", text: ev.delta.text, at })
        }
      } else if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            this.opts.onEvent({ kind: "text", text: block.text, at })
          } else if (block.type === "tool_use") {
            this.opts.onEvent({ kind: "status", status: "working" })
            this.opts.onEvent({ kind: "tool", name: block.name, summary: summarizeTool(block.name, block.input), at })
          }
        }
      } else if (msg.type === "result") {
        if (this.interrupting) {
          // This is the interrupted turn's result — interrupt() already told
          // the HUD "cancelled"; a turn_done here would flip cards to DONE.
          this.interrupting = false
          this.opts.onEvent({ kind: "status", status: "idle" })
          continue
        }
        this.opts.onEvent({
          kind: "turn_done",
          costUsd: "total_cost_usd" in msg ? (msg.total_cost_usd ?? null) : null,
          at,
        })
        this.opts.onEvent({ kind: "status", status: "idle" })
      }
    }

    // The stream ended (e.g. turn budget exhausted or CLI exit). Without this,
    // `running` stays true and every later dispatch queues into a dead session
    // with zero error UI — the silent-death failure mode. The next dispatch()
    // now auto-restarts via start().
    this.running = false
    this.q = null
    this.opts.onEvent({ kind: "status", status: "error", detail: "agent session ended — next dispatch restarts it" })
  }
}

function summarizeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (name === "Bash") return String(i.description ?? i.command ?? "").slice(0, 90)
  if (name === "Write") return `write ${String(i.file_path ?? "")}`
  if (name === "Edit") return `edit ${String(i.file_path ?? "")}`
  if (name === "Read") return `read ${String(i.file_path ?? "")}`
  // MCP tools arrive as mcp__<server>__<tool>. Render "<tool> <first-arg>" so the
  // HUD's vision/eyes chip (mcp__videodb*) and web chip (mcp__brightdata*) read
  // as actions, e.g. "videodb: search_scenes osaka skyline".
  if (name.startsWith("mcp__")) {
    const parts = name.split("__")
    const server = parts[1] ?? ""
    const tool = parts.slice(2).join("__") || server
    const first = Object.values(i).find((v) => typeof v === "string") as string | undefined
    return `${server}: ${tool}${first ? ` ${first.slice(0, 60)}` : ""}`.trim()
  }
  const first = Object.values(i)[0]
  return `${name} ${String(typeof first === "string" ? first : "").slice(0, 70)}`.trim()
}
