// THE CONTRACT between main, preload, voice layer, and HUD.
// All three build tracks code against this file. Do not drift from it.

// Where a dispatch came from. "vision" = a VideoDB RTStream event the agent
// SAW (webhook → main → queue), the eyes counterpart to spoken/typed intent.
export type DispatchSource = "voice" | "typed" | "vision"

// FAST LANE: deterministic actions the dispatcher runs DIRECTLY (skipping the
// Claude agent) so a simple "open chrome" is ~1s, not an agent round-trip.
export interface DirectAction {
  kind: "open_app" | "open_url"
  value: string // app name (open -a) or URL (open)
}

export type AgentEvent =
  | { kind: "status"; status: "starting" | "ready" | "working" | "idle" | "error"; detail?: string }
  // id is assigned by main, monotonically increasing; cards are keyed by it.
  // source defaults to "typed" when absent; "vision" cards get an eye/purple tint.
  | { kind: "dispatched"; id: number; text: string; at: number; source?: DispatchSource }
  // TokenRouter fast lane: a 4-word label for card `id`. May never arrive — HUD
  // must render a truncated-instruction fallback from the start.
  | { kind: "label"; id: number; label: string }
  | { kind: "text"; text: string; at: number } // "✓ ..." lines mark the oldest ACTING card DONE
  | { kind: "text_delta"; text: string; at: number }
  | { kind: "tool"; name: string; summary: string; at: number } // name starting "mcp__brightdata" → purple chip
  | { kind: "turn_done"; costUsd: number | null; at: number } // all ACTING cards → DONE
  | { kind: "cancelled"; at: number } // queue cleared + interrupt: QUEUED/ACTING cards → CANCELLED
  | { kind: "error"; message: string; at: number }

export interface DispatchConfig {
  geminiKey: string | null
  workspace: string
  platform: string
  brightdata: boolean // token present → enable the Bright Data demo beat + preflight row
  videodb: boolean // token present → VideoDB eyes (MCP tool + RTStream vision dispatch)
}

export interface PreflightResult {
  gemini: "ok" | "fail" | "skip" // skip = no key
  agent: "ok" | "fail" // runner session ready/idle
  brightdata: "ok" | "fail" | "skip" // skip = no token
  videodb: "ok" | "fail" | "skip" // skip = no token
}

// macOS TCC status. Mirrors systemPreferences.getMediaAccessStatus for mic/screen;
// automation has no query API, so it's "will-prompt" until first AppleScript use.
export type PermissionState = "granted" | "denied" | "restricted" | "not-determined" | "will-prompt" | "unknown"

export interface PermissionStatus {
  microphone: PermissionState
  screen: PermissionState // computer-use eyes (screencapture) + VideoDB
  accessibility: PermissionState // computer-use hands (cliclick mouse/keyboard)
  automation: PermissionState // always "will-prompt" on macOS (no status API), "granted" off-darwin
}

export interface DispatchApi {
  // source lets the HUD tag where a dispatch came from; defaults to "typed".
  send(text: string, source?: DispatchSource): void
  // Fast lane: run a deterministic action immediately, no agent round-trip.
  runDirect(action: DirectAction): void
  // Computer-use lane: take over cursor+screen to do a click/type GUI task.
  computerTask(instruction: string): void
  interrupt(): void
  cancelLast(): void
  onAgentEvent(cb: (e: AgentEvent) => void): () => void
  getConfig(): Promise<DispatchConfig>
  preflight(): Promise<PreflightResult>
  // Permissions onboarding. Packaged + signed, these prompts attribute to the
  // app itself. getPermissions reads current TCC status; the request* methods
  // front each OS flow; the open* methods open the right System Settings pane.
  getPermissions(): Promise<PermissionStatus>
  requestMic(): Promise<boolean> // askForMediaAccess('microphone')
  requestScreen(): Promise<void> // triggers the screen-recording prompt (desktopCapturer probe)
  requestAccessibility(): Promise<boolean> // prompts/opens the Accessibility grant (for cliclick)
  openScreenSettings(): void // Privacy → Screen Recording pane
  openAutomationSettings(): void // Privacy → Automation pane
}

// Voice hook public surface (implemented in voice/use-live-dispatcher.ts,
// consumed by the HUD).
export type VoiceStatus = "idle" | "connecting" | "live" | "error" | "unsupported"
export type ToolHandler = (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>

export interface VoiceApi {
  status: VoiceStatus
  speaking: boolean // the dispatcher's own (tiny) voice
  listening: boolean
  heard: string // running transcript of the USER's words (cosmetic ribbon)
  level: number // 0..1 mic RMS, throttled ~10Hz (preflight meter + orb ring)
  // Actionable failure reason for the HUD banner; null when fine. Distinguishes
  // mic-denied ("Microphone blocked — grant access") from connect-failed.
  error: string | null
  start(opts: { apiKey: string; onTool: ToolHandler; silenceMs?: number }): Promise<void>
  stop(): void
  tellDispatcher(text: string): void // rides the mid-turn-safe queue
}

// IPC channel names
export const IPC = {
  send: "dispatch:send",
  runDirect: "dispatch:run-direct",
  computer: "dispatch:computer",
  interrupt: "dispatch:interrupt",
  cancelLast: "dispatch:cancel-last",
  config: "dispatch:config",
  preflight: "dispatch:preflight",
  getPermissions: "dispatch:get-permissions",
  requestMic: "dispatch:request-mic",
  requestScreen: "dispatch:request-screen",
  requestAccessibility: "dispatch:request-accessibility",
  openScreenSettings: "dispatch:open-screen-settings",
  openAutomationSettings: "dispatch:open-automation-settings",
  agentEvent: "agent:event",
} as const

// VideoDB vision: the local webhook receiver binds here (127.0.0.1 only).
// RTStream is pointed at this port via an ngrok tunnel during rehearsal.
export const VISION_PORT = 8765
