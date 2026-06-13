// Computer use — the cursor-takeover lane. A Sonnet session SEES the screen
// (screencapture → downscaled to logical points) and drives the real mouse +
// keyboard via cliclick, looping screenshot → click/type → screenshot until the
// task is done. This is the slow-but-capable path (≈1–3s per action), used for
// click-heavy GUI/web tasks the fast/agent lanes can't do (subscribe on YouTube,
// search a site). Needs Screen Recording (screencapture) + Accessibility (cliclick).
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"
import type { AgentEvent } from "../shared/types"

const run = promisify(execFile)
const CLICLICK = "/opt/homebrew/bin/cliclick"
const SHOT_PATH = join(tmpdir(), "dispatch-screen.png")

const SYSTEM = `You operate this macOS computer by looking at the screen and using the mouse and keyboard, like a person.
- ALWAYS start by calling screenshot to see the current screen.
- The screenshot is in LOGICAL points; the coordinates you pass to click/move/etc. are the SAME coordinate space, so click exactly where you see the target.
- Work in small steps: screenshot → act (move/click/type/key) → screenshot to verify the result changed → continue. Don't guess blindly; look first.
- To type into a field, click it first, then type_text. Use press_key for Return/Tab/Cmd+L etc.
- Be efficient: take a fresh screenshot only when the screen has likely changed. Stop as soon as the task is clearly done and say one short line of what you did, starting with "✓ ".
- If something is blocked or you can't find the target after a few tries, stop and say "✗ " plus why.`

export interface ComputerOptions {
  onEvent: (e: AgentEvent) => void
  // Logical (point) size + scale of the primary display, from Electron's screen API.
  logicalWidth: number
  logicalHeight: number
  scaleFactor: number
  model?: string
  nextId: () => number
}

async function cliclick(args: string[]): Promise<void> {
  await run(CLICLICK, args)
}

// Capture the full (pixel) screen, then downscale to LOGICAL width so the image
// the model sees matches the point coordinates cliclick uses. Uses sips (built
// into macOS) — no image-library dependency.
async function screenshotBase64(logicalWidth: number): Promise<string> {
  await mkdir(tmpdir(), { recursive: true }).catch(() => {})
  await run("screencapture", ["-x", "-T", "0", SHOT_PATH])
  await run("sips", ["--resampleWidth", String(logicalWidth), SHOT_PATH]).catch(() => {})
  const buf = await readFile(SHOT_PATH)
  return buf.toString("base64")
}

function buildServer(opts: ComputerOptions) {
  const ev = (name: string, summary: string) =>
    opts.onEvent({ kind: "tool", name: `computer:${name}`, summary, at: Date.now() })

  const xy = { x: z.number().describe("x in logical points"), y: z.number().describe("y in logical points") }

  return createSdkMcpServer({
    name: "computer",
    tools: [
      tool("screenshot", "Capture the current screen so you can see what to do next.", {}, async () => {
        ev("screenshot", "looking at the screen")
        const data = await screenshotBase64(opts.logicalWidth)
        return {
          content: [
            { type: "image", data, mimeType: "image/png" },
            {
              type: "text",
              text: `Screen is ${opts.logicalWidth}x${opts.logicalHeight} logical points. Click using these coordinates.`,
            },
          ],
        }
      }),
      tool("mouse_move", "Move the cursor to (x,y).", xy, async ({ x, y }) => {
        ev("move", `${x},${y}`)
        await cliclick([`m:${Math.round(x)},${Math.round(y)}`])
        return { content: [{ type: "text", text: `moved to ${x},${y}` }] }
      }),
      tool("left_click", "Left-click at (x,y).", xy, async ({ x, y }) => {
        ev("click", `${x},${y}`)
        await cliclick([`c:${Math.round(x)},${Math.round(y)}`])
        return { content: [{ type: "text", text: `clicked ${x},${y}` }] }
      }),
      tool("double_click", "Double-click at (x,y).", xy, async ({ x, y }) => {
        ev("double_click", `${x},${y}`)
        await cliclick([`dc:${Math.round(x)},${Math.round(y)}`])
        return { content: [{ type: "text", text: `double-clicked ${x},${y}` }] }
      }),
      tool("right_click", "Right-click at (x,y).", xy, async ({ x, y }) => {
        ev("right_click", `${x},${y}`)
        await cliclick([`rc:${Math.round(x)},${Math.round(y)}`])
        return { content: [{ type: "text", text: `right-clicked ${x},${y}` }] }
      }),
      tool("type_text", "Type a string at the current focus. Click a field first.", { text: z.string() }, async ({ text }) => {
        ev("type", text.slice(0, 40))
        await cliclick([`t:${text}`])
        return { content: [{ type: "text", text: `typed ${text.length} chars` }] }
      }),
      tool(
        "press_key",
        "Press a key or shortcut, e.g. 'return', 'tab', 'esc', 'space', 'cmd+l', 'cmd+a'.",
        { key: z.string() },
        async ({ key }) => {
          ev("key", key)
          await cliclick([`kp:${key}`])
          return { content: [{ type: "text", text: `pressed ${key}` }] }
        },
      ),
      tool(
        "scroll",
        "Scroll at (x,y); amount>0 scrolls down, <0 up.",
        { ...xy, amount: z.number() },
        async ({ x, y, amount }) => {
          ev("scroll", `${amount}`)
          await cliclick([`s:${Math.round(x)},${Math.round(y)},${Math.round(amount)}`])
          return { content: [{ type: "text", text: `scrolled ${amount}` }] }
        },
      ),
      tool("wait", "Wait a number of milliseconds for the screen to settle.", { ms: z.number() }, async ({ ms }) => {
        await new Promise((r) => setTimeout(r, Math.min(4000, Math.max(0, ms))))
        return { content: [{ type: "text", text: `waited ${ms}ms` }] }
      }),
    ],
  })
}

/** Run one GUI task to completion via the screenshot→act loop. */
export async function runComputerTask(instruction: string, opts: ComputerOptions): Promise<void> {
  const id = opts.nextId()
  const at = Date.now()
  opts.onEvent({ kind: "dispatched", id, text: instruction, at, source: "voice" })

  const server = buildServer(opts)
  try {
    const q = query({
      prompt: instruction,
      options: {
        model: opts.model || "claude-sonnet-4-6",
        systemPrompt: SYSTEM,
        mcpServers: { computer: server },
        permissionMode: "bypassPermissions",
        includePartialMessages: false,
        maxTurns: 25,
      },
    })
    for await (const msg of q) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            opts.onEvent({ kind: "text", text: block.text, at: Date.now() })
          }
        }
      } else if (msg.type === "result") {
        opts.onEvent({ kind: "turn_done", costUsd: "total_cost_usd" in msg ? (msg.total_cost_usd ?? null) : null, at: Date.now() })
      }
    }
  } catch (err) {
    opts.onEvent({ kind: "text", text: `✗ Computer task failed: ${(err as Error).message}`, at: Date.now() })
    opts.onEvent({ kind: "turn_done", costUsd: null, at: Date.now() })
  }
}
