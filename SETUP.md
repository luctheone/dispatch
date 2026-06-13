# Claude Dispatch — full setup manual

All paths assume the repo root: `/Users/lucas/Documents/dispatch`.

## TL;DR minimum to a working demo
1. Get a Gemini API key (Part 1).
2. `cp .env.example .env` and paste the key (Part 3).
3. `npm run dev`, click **Enable Dispatch**, allow the mic (Part 5).
That's the full speak→act loop. Everything else is sponsor integrations you add on top.

The **hands** (the Claude agent) already work with no key — they ride your Claude
Code login. Only **voice** needs the Gemini key. So you can test the agent right
now via the typed box even before Part 1.

---

## Part 0 — one-time machine prerequisites

```bash
# You already have: Node 24, npm, the app's node_modules, Claude Code (logged in).
# Verify in the repo:
cd /Users/lucas/Documents/dispatch
node --version          # expect v24.x
claude --version        # confirms the agent's auth rides this
ls node_modules >/dev/null && echo "deps ok"   # if missing: npm install
```

Two extra installs, ONLY if you want the VideoDB sponsor paths (Part 6):
```bash
brew install uv        # required for VideoDB "eyes-as-a-tool" (Path A) — NOT installed yet
brew install ngrok     # required for VideoDB live vision (Path B)
```

---

## Part 1 — Gemini API key (voice) — ESSENTIAL

You use Vertex/service-account today, but Dispatch's voice pipeline wants a
Gemini **Developer API** key. Make one tied to your credit-bearing Cloud project
so it still spends your free credits and gets paid-tier rate limits.

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with the Google account that owns the Cloud project holding your credits.
3. Click **Create API key** → **Create API key in existing project**.
4. Pick the **GCP project that has your free credits / billing enabled**.
5. Copy the key (it starts with `AIza…`).

This is the only ESSENTIAL key. Usage bills to that project = your credits.

---

## Part 2 — sponsor accounts/keys (each OPTIONAL but worth points)

| Sponsor | Get the key at | What you get |
|---|---|---|
| **Bright Data** | `get.brightdata.com/aibuilders10` → API token | live web inside the agent |
| **VideoDB** | `videodb.io` → console → API key ($520 credits) | the agent's eyes |
| **TokenRouter** | `tinyurl.com/tokenroutercredits` → API key | card labels on every card |
| **Kimi k2.6** | `theaibuilders.dev/kimicredits` → Moonshot key | "executor also runs on Kimi" toggle |

---

## Part 3 — create and fill `.env`

```bash
cd /Users/lucas/Documents/dispatch
cp .env.example .env
open -e .env      # or: code .env / nano .env
```

Fill in what you have. The only required line is `GEMINI_API_KEY`:

```bash
# REQUIRED — voice
GEMINI_API_KEY=AIza...your-key...

# OPTIONAL — agent model (defaults to your Claude Code default if unset)
# DISPATCH_MODEL=claude-sonnet-4-6

# OPTIONAL — Bright Data (live web)
BRIGHTDATA_API_TOKEN=...

# OPTIONAL — VideoDB (eyes: MCP tool + RTStream vision). One key, both paths.
VIDEODB_API_KEY=...

# OPTIONAL — TokenRouter (card labels). Base URL/model have sane defaults.
TOKENROUTER_API_KEY=...
# TOKENROUTER_BASE_URL=https://api.tokenrouter.io/v1
# TOKENROUTER_MODEL=auto

# OPTIONAL — Kimi executor toggle. Leave OFF for the demo (demo on Claude).
# DISPATCH_EXECUTOR=kimi
# KIMI_API_KEY=...
```

`.env` is gitignored — it stays local. Save and close.

---

## Part 4 — MCP gate + VideoDB installs

**Important reliability note.** Bright Data and VideoDB-eyes-as-a-tool load as
**MCP servers that block the agent's boot until they connect over the network**.
To keep the core speak→act loop from ever being hung by flaky venue wifi, they
are **OFF by default**. The core loop and VideoDB *vision* (the RTStream webhook,
Part 7) work without them.

To enable the Bright Data web beat + VideoDB eyes-as-a-tool for the demo:
1. `brew install uv` (Part 0) — required for the VideoDB MCP server.
2. Add `DISPATCH_MCP=on` to `.env`.
3. **Pre-warm**: launch the app once on your demo network ~10 min before your
   slot so both servers download/cache and you confirm it reaches a green agent
   dot. If it's slow/hangs on venue wifi, set `DISPATCH_MCP=on` back to off (or
   remove it) — the core demo is unaffected.

(First-ever launch with MCP on downloads the packages; if your disk is low or the
network drops mid-download it can corrupt the cache — clear it with
`rm -rf ~/.npm/_npx` and relaunch.)

---

## Part 5 — build the app, launch, grant permissions

Dispatch now runs as a **real signed macOS app** (not `npm`/terminal). This is
what makes the mic + screen-recording prompts attribute to "Claude Dispatch"
instead of VS Code/Terminal.

```bash
cd /Users/lucas/Documents/dispatch
npm run make-app          # build → package → sign → installs to /Applications/Claude Dispatch.app
open -a "Claude Dispatch"
```

Rebuild any time with `npm run make-app`. (For fast UI iteration you can still
use `npm run dev`, but the real permissions only work from the packaged app.)

First launch:
1. The **onboarding** screen lists three permissions with live status:
   - **Microphone** (required for voice) → click Grant → macOS prompt says
     **"Claude Dispatch"** → Allow.
   - **Screen Recording** (only for VideoDB watch) → Grant opens the prompt;
     finish the toggle in System Settings if asked, then return.
   - **Automation** (only for app-control) → prompts on first use.
2. Click **Continue** once the mic is granted (or **Skip** to use typed-only).
3. Gatekeeper note: it's ad-hoc signed (no Apple Developer account), so if macOS
   ever blocks it, right-click the app → **Open** once. Locally built ⇒ usually no
   prompt. Permissions persist across launches thanks to the stable signature.

Why a real app: launched from a terminal, macOS blamed VS Code for permissions
and silently denied the mic (the orb "flashed and died"). As a signed
`Claude Dispatch.app`, the OS attributes everything to the app itself.

---

## Part 6 — test it

**Typed lane (works without the Gemini key):** type into the bottom box —
`make a folder on my desktop called test-run with a hello.txt inside` → Dispatch.
Watch the card go QUEUED → ACTING → DONE and check your Desktop.

**Voice lane (needs the Gemini key):** tap the 🎙 orb, then speak naturally:
*"make a folder on my desktop called osaka-trip, and put a packing list in it"* —
cards should fly in mid-sentence.

**Bright Data:** with the token set, say *"check if the SMU library is open right
now"* — a purple `brightdata` tool line should stream live web data.

---

## Part 7 — VideoDB live vision (Path B) — rehearsal setup

This is the stretch beat. Three moving parts. Do it at rehearsal, not cold.

1. **Expose the local receiver** (terminal A):
   ```bash
   ngrok http 8765
   ```
   Copy the `https://xxxx.ngrok.app` URL it prints.

2. **Produce a desktop RTSP stream** — VideoDB needs a video source. Use their
   capture quickstart (publishes your screen as a local RTSP feed):
   `github.com/video-db/videodb-capture-quickstart`. Note the RTSP URL it gives,
   e.g. `rtsp://127.0.0.1:8554/desktop`.

3. **Register the stream + event + webhook** (terminal B, from the repo root):
   ```bash
   VIDEODB_API_KEY=sk-...                                            \
   WEBHOOK_URL=https://xxxx.ngrok.app                               \
   RTSP_URL=rtsp://127.0.0.1:8554/desktop                          \
   EVENT_PROMPT="a terminal or editor window shows an error message" \
   node scripts/videodb-rtstream.mjs
   ```
   It prints each step's ID. If any step 4xxs, it dumps the response body so you
   can fix a field live (a few RTStream field names are marked `VERIFY:` in the
   script since I couldn't confirm them all against the docs).

Now, with `npm run dev` running, when your `EVENT_PROMPT` condition appears on
screen, VideoDB fires the webhook → a purple 👁 **"SAW THIS"** card drops onto the
board on its own and the agent acts. **If the live stream is flaky at the venue,
cut this beat** and fall back to Path A ("watch this recording, tell me where it
broke") — still names VideoDB, no live stream required.

---

## Part 8 — verification checklist before you walk up

- [ ] `.env` has `GEMINI_API_KEY` (+ any sponsor keys)
- [ ] `npm run dev` opens the HUD; agent status dot is green
- [ ] Typed dispatch creates a file on your Desktop
- [ ] Mic orb goes live; spoken dispatch fires cards mid-sentence
- [ ] Click **preflight** (footer) → Gemini / Agent / Bright Data / VideoDB / Mic rows green or skip
- [ ] (If using VideoDB Path A) `which uvx` returns a path
- [ ] Phone hotspot is your demo network, not venue wifi
- [ ] Fresh voice session started <10 min before your slot (15-min cap)

The full demo script + stage discipline is in `DEMO.md`; logistics + sponsor plan
in `HACKATHON.md`; submission copy in `SUBMISSIONS.md`.
