import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, systemPreferences, shell } from "electron"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync, readFileSync, existsSync } from "node:fs"
import {
  IPC,
  VISION_PORT,
  type AgentEvent,
  type DispatchConfig,
  type DispatchSource,
  type PermissionState,
  type PermissionStatus,
  type PreflightResult,
} from "../shared/types"
import { AgentRunner } from "./agent"
import { startVisionServer } from "./vision"

// Load dispatch/.env (GEMINI_API_KEY etc.) without a dotenv dependency. A
// packaged .app has neither app.getAppPath()/.env nor a useful cwd, so we also
// read the user-home locations the integrator copies keys into. First found for
// each key wins; an already-set process.env key is never overwritten.
function loadEnvFile() {
  for (const p of [
    join(app.getAppPath(), ".env"),
    join(process.cwd(), ".env"),
    join(homedir(), "Dispatch", ".env"),
    join(homedir(), ".claude-dispatch.env"),
  ]) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
}

const WORKSPACE = join(homedir(), "Dispatch")

let win: BrowserWindow | null = null
let runner: AgentRunner | null = null
let visionServer: { close(): void } | null = null
let lastStatus: "starting" | "ready" | "working" | "idle" | "error" = "starting"

function sendToHud(e: AgentEvent) {
  win?.webContents.send(IPC.agentEvent, e)
}

function createWindow() {
  // The demo stage: a tall sidebar docked to the right edge of the primary
  // display, always on top, leaving the desktop visible as the agent works.
  // (screen API is only usable after app ready; createWindow runs post-ready.)
  const workArea = screen.getPrimaryDisplay().workArea
  const width = 460
  const height = 760

  win = new BrowserWindow({
    width,
    height,
    minWidth: 420,
    minHeight: 480,
    x: workArea.x + workArea.width - width - 12,
    y: workArea.y + Math.max(12, Math.round((workArea.height - height) / 2)),
    alwaysOnTop: true,
    resizable: true,
    title: "Claude Dispatch",
    backgroundColor: "#0a0a0c",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      // ESM preload requires an unsandboxed renderer; contextIsolation stays on.
      sandbox: false,
    },
  })

  // External links open in the real browser, not inside the HUD.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Status events sent before the renderer subscribed are dropped — replay the
  // latest one on every load so the header never sticks on "starting".
  win.webContents.on("did-finish-load", () => {
    sendToHud({ kind: "status", status: lastStatus })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

async function checkGemini(): Promise<PreflightResult["gemini"]> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return "skip"
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(4000) },
    )
    return res.ok ? "ok" : "fail"
  } catch {
    return "fail"
  }
}

async function checkBrightData(): Promise<PreflightResult["brightdata"]> {
  if (!process.env.BRIGHTDATA_API_TOKEN) return "skip"
  try {
    // Any HTTP response (incl. 4xx) proves the endpoint is reachable.
    await fetch("https://api.brightdata.com", { signal: AbortSignal.timeout(4000) })
    return "ok"
  } catch {
    return "fail"
  }
}

async function checkVideoDb(): Promise<PreflightResult["videodb"]> {
  if (!process.env.VIDEODB_API_KEY) return "skip"
  try {
    // Any HTTP response (incl. 401/4xx for the unauthenticated probe) proves the
    // VideoDB REST API is reachable — only a network error/timeout is a "fail".
    await fetch("https://api.videodb.io", { signal: AbortSignal.timeout(4000) })
    return "ok"
  } catch {
    return "fail"
  }
}

app.whenReady().then(async () => {
  loadEnvFile()
  mkdirSync(WORKSPACE, { recursive: true })
  // When launched from Finder, PATH lacks user bin dirs — the Agent SDK needs
  // to find the `claude` binary.
  process.env.PATH = `${process.env.PATH}:${homedir()}/.local/bin:/opt/homebrew/bin`
  console.log("[dispatch] booting")

  runner = new AgentRunner({
    cwd: WORKSPACE,
    model: process.env.DISPATCH_MODEL || undefined,
    onEvent: (e) => {
      if (e.kind === "status") {
        lastStatus = e.status
        console.log("[dispatch] agent status:", e.status, e.detail ?? "")
      }
      sendToHud(e)
    },
  })

  ipcMain.on(IPC.send, (_e, text: string, source?: DispatchSource) => runner?.dispatch(text, source))
  ipcMain.on(IPC.interrupt, () => void runner?.interrupt())
  ipcMain.on(IPC.cancelLast, () => runner?.cancelLast())
  // Permissions onboarding. Packaged + signed, every prompt below is attributed
  // to "Claude Dispatch" itself (not the launcher). No prompt fires at boot.
  ipcMain.handle(IPC.getPermissions, (): PermissionStatus => {
    if (process.platform !== "darwin") {
      return { microphone: "granted", screen: "granted", automation: "granted" }
    }
    // Electron's status strings are a superset of PermissionState's mic/screen
    // values; automation has no query API so it's always "will-prompt".
    return {
      microphone: systemPreferences.getMediaAccessStatus("microphone") as PermissionState,
      screen: systemPreferences.getMediaAccessStatus("screen") as PermissionState,
      automation: "will-prompt",
    }
  })
  ipcMain.handle(IPC.requestMic, async (): Promise<boolean> => {
    if (process.platform !== "darwin") return true
    try {
      const ok = await systemPreferences.askForMediaAccess("microphone")
      console.log("[dispatch] mic access:", ok)
      return ok
    } catch {
      return false
    }
  })
  ipcMain.handle(IPC.requestScreen, async (): Promise<void> => {
    if (process.platform !== "darwin") return
    try {
      // Enumerating screen sources is itself what trips the TCC screen-recording
      // prompt — a 1x1 thumbnail keeps the probe cheap. We don't use the result.
      await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } })
    } catch {
      // Denied/cancelled — onboarding re-reads status via getPermissions.
    }
  })
  ipcMain.handle(IPC.openScreenSettings, () => {
    void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
  })
  ipcMain.handle(IPC.openAutomationSettings, () => {
    void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
  })
  ipcMain.handle(IPC.config, (): DispatchConfig => ({
    geminiKey: process.env.GEMINI_API_KEY ?? null,
    workspace: WORKSPACE,
    platform: process.platform,
    brightdata: !!process.env.BRIGHTDATA_API_TOKEN,
    videodb: !!process.env.VIDEODB_API_KEY,
  }))
  ipcMain.handle(IPC.preflight, async (): Promise<PreflightResult> => {
    const [gemini, brightdata, videodb] = await Promise.all([checkGemini(), checkBrightData(), checkVideoDb()])
    const agent = lastStatus === "ready" || lastStatus === "idle" || lastStatus === "working" ? "ok" : "fail"
    return { gemini, agent, brightdata, videodb }
  })

  createWindow()
  console.log("[dispatch] window created; workspace:", WORKSPACE)
  // Pre-warm the agent session NOW (the SDK inits lazily on first message, so a
  // silent priming ping initializes it at boot → status goes green and the first
  // real spoken dispatch skips the ~5-8s cold-start).
  runner.start()
  if (!process.env.DISPATCH_TEST_PROMPT) runner.prewarm()

  // Path B — the eyes. A VideoDB RTStream alert webhook (tunnelled via ngrok)
  // lands here and becomes a dispatch on the SAME queue the voice layer feeds.
  visionServer = startVisionServer((text) => runner?.dispatch(text, "vision"))
  console.log("[dispatch] vision webhook listening on", VISION_PORT)

  // Panic button: ⌘-. stops everything even when the HUD isn't focused.
  const gotShortcut = globalShortcut.register("CommandOrControl+.", () => void runner?.interrupt())
  if (!gotShortcut) console.log("[dispatch] WARNING: ⌘-. global shortcut unavailable (another app owns it); Esc in the HUD still works")

  // Headless E2E hook: DISPATCH_TEST_PROMPT dispatches one instruction at boot.
  if (process.env.DISPATCH_TEST_PROMPT) {
    runner.dispatch(process.env.DISPATCH_TEST_PROMPT)
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("will-quit", () => {
  globalShortcut.unregisterAll()
  visionServer?.close()
  visionServer = null
})

app.on("window-all-closed", () => {
  void runner?.stop()
  visionServer?.close()
  visionServer = null
  app.quit()
})
