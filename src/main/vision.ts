// Path B — the agent's "eyes" as a DISPATCH source. A VideoDB RTStream alert
// fires a webhook (<1s) when a natural-language scene condition is met; that
// webhook is tunnelled (ngrok) to this local receiver, which turns the SEEN
// event into a dispatch on the SAME queue the voice layer feeds. So Dispatch
// acts on what you SAY and what it SEES through one architecture.
//
// Bind localhost only: ngrok is the public face; nothing else may reach this.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { VISION_PORT } from "../shared/types"

// Cap the body we'll buffer — a webhook is tiny; anything large is junk/abuse.
const MAX_BODY_BYTES = 64 * 1024

interface VisionServer {
  close(): void
}

// VideoDB's alert webhook (observed shape):
//   { channel:"alert", timestamp, rtstream_id, rtstream_name,
//     data:{ event_id, label, triggered, confidence, start, end } }
// The full natural-language event_prompt is set when the EVENT is created, not
// echoed in every alert, so we extract the best human-readable signal available
// and stay tolerant of shape drift across VideoDB versions.
function extractInstruction(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>
  const event = (b.event && typeof b.event === "object" ? b.event : {}) as Record<string, unknown>

  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null
    const t = v.trim()
    return t.length > 0 ? t : null
  }

  // Most-specific natural-language description first, then labels, then context.
  const primary =
    str(b.event_prompt) ??
    str(data.event_prompt) ??
    str(event.event_prompt) ??
    str(b.description) ??
    str(data.description) ??
    str(event.description) ??
    str(b.message) ??
    str(b.text) ??
    str(b.prompt) ??
    str(b.label) ??
    str(data.label) ??
    str(event.label)
  if (!primary) return null

  // Add the stream name as scene context when the signal is a bare label.
  const stream = str(b.rtstream_name) ?? str(data.rtstream_name)
  const instruction = stream && primary.split(/\s+/).length <= 3 ? `${primary} (seen on ${stream})` : primary

  return `Vision event — ${instruction}. Look at what's on screen and act on it.`
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    let aborted = false
    req.on("data", (chunk: Buffer) => {
      if (aborted) return
      data += chunk.toString("utf8")
      if (data.length > MAX_BODY_BYTES) {
        aborted = true
        reject(new Error("body too large"))
        req.destroy()
      }
    })
    req.on("end", () => {
      if (!aborted) resolve(data)
    })
    req.on("error", reject)
  })
}

function reply(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { "content-type": "application/json" })
  res.end(body)
}

/**
 * Start the local vision webhook receiver. Returns a handle whose close()
 * shuts the server down. Never throws on a bad request — a malformed webhook
 * must not crash the agent the user is mid-demo with.
 */
export function startVisionServer(onVisionDispatch: (text: string) => void): VisionServer {
  const server = createServer((req, res) => {
    // ngrok / load-balancer sanity probe.
    if (req.method === "GET" && req.url && req.url.split("?")[0] === "/health") {
      reply(res, 200, { ok: true })
      return
    }

    if (req.method !== "POST") {
      reply(res, 405, { ok: false, error: "POST only" })
      return
    }

    readBody(req)
      .then((raw) => {
        const trimmed = raw.trim()
        if (!trimmed) {
          // Empty body is a benign probe; acknowledge without dispatching.
          reply(res, 200, { ok: true, dispatched: false })
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          reply(res, 400, { ok: false, error: "invalid JSON" })
          return
        }
        const instruction = extractInstruction(parsed)
        if (!instruction) {
          // Valid JSON but nothing actionable (e.g. triggered:false heartbeat) —
          // ack 200 so VideoDB doesn't retry, but don't fire a dispatch.
          reply(res, 200, { ok: true, dispatched: false })
          return
        }
        // Respond FAST (the webhook budget is tight) before doing local work.
        reply(res, 200, { ok: true, dispatched: true })
        try {
          onVisionDispatch(instruction)
        } catch (err) {
          console.error("[dispatch] vision dispatch handler threw:", err)
        }
      })
      .catch((err) => {
        console.error("[dispatch] vision webhook read error:", err?.message ?? err)
        if (!res.headersSent) reply(res, 400, { ok: false, error: "bad request" })
      })
  })

  // A listen error (e.g. port in use) must surface, not silently no-op the eyes.
  server.on("error", (err) => {
    console.error("[dispatch] vision server error:", err?.message ?? err)
  })

  // 127.0.0.1 only — never 0.0.0.0. ngrok is the sole public path in.
  server.listen(VISION_PORT, "127.0.0.1")

  return {
    close() {
      server.close()
    },
  }
}
