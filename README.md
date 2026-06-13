# Claude Dispatch

**Speak. It's already doing it.**

A desktop-native agent that acts **while you talk**. Dictation tools make you finish your thought, read it back, fix it, then submit it — and only then does anything happen. For people with ADHD and dyslexia (like the builder), that dictate → prompt → wait loop burns the two things in shortest supply: time and attention.

Dispatch deletes the loop. As you speak, a live dispatcher segments your speech into actionable intents and pushes each one into a **running** Claude agent session the moment it's coherent — the agent is doing step 1 while you're still explaining step 3. Like briefing a great chief of staff, not filling in a form.

## Requirements (bring your own Claude + Gemini)

Dispatch is the front end — **the agent runs on _your_ Claude Code, and voice runs on _your_ Gemini key.** Before it works you need:

1. **A Mac with Apple Silicon** (M1 or newer). This build is arm64.
2. **Claude Code, logged in.** The agent rides your Claude Code authentication. Install it and log in **once, in a terminal** — this is the only terminal step:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   claude        # complete the browser login (Claude Pro/Max, or an Anthropic API key)
   ```
   The login is saved in your macOS Keychain, so **after that the app runs on its own — you never need a terminal open again.** Note: the **Claude _desktop app_ login does not count** — it's a separate auth store; it has to be the `claude` CLI.
3. **A Gemini API key** for voice — free from [Google AI Studio](https://aistudio.google.com/apikey). Put it in `~/Dispatch/.env` as `GEMINI_API_KEY=...`. Without it, typed dispatch still works; voice doesn't.

Optional sponsor keys (Bright Data, VideoDB, TokenRouter, Kimi) unlock extra features — see [`SETUP.md`](SETUP.md).

## How it works

```
mic (16kHz PCM) ──► Gemini Live (speech-native dispatcher)
                        │  fires tool calls MID-SENTENCE:
                        │  dispatch_task / amend_task / cancel_all
                        ▼
                  Electron main process
                        │  pushes messages into a RUNNING session
                        ▼
            Claude Agent SDK (streaming input, pre-warmed)
                        │  Bash · osascript · files · open ·
                        │  Bright Data MCP (live web)
                        ▼
              your actual Mac, doing the thing
```

- **Voice layer**: a battle-tested Gemini Live pipeline (barge-in, mid-turn queueing, double-session guard). The dispatcher's only voice is ≤2-word acknowledgements — it never chats, because the agent's *work* is the response.
- **Execution layer**: `@anthropic-ai/claude-agent-sdk` with **streaming input** — new spoken instructions are appended to the live turn. Amendments ("actually, make it blue") land as messages mid-task; "stop" maps to a hard `interrupt()`.
- **Live web**: Bright Data's official MCP server plugs straight into the Agent SDK (`BRIGHTDATA_API_TOKEN`).
- **Alt executor**: `DISPATCH_EXECUTOR=kimi` retargets the agent loop at Moonshot's Anthropic-compatible endpoint (kimi-k2.6).

## Run it

```bash
cd dispatch
npm install
cp .env.example .env      # add GEMINI_API_KEY (voice) + optional sponsor keys
npm run make-app          # build + sign → installs to /Applications/Claude Dispatch.app
open -a "Claude Dispatch"
```

You need: **Claude Code installed and logged in** (the agent rides that auth — no Anthropic key needed) and a **Gemini API key** for voice. First launch shows a permissions onboarding; the mic prompt is attributed to "Claude Dispatch". Full setup in [`SETUP.md`](SETUP.md).

No mic / no key? The input box at the bottom dispatches typed instructions through the exact same pipeline.

## Why "dispatch"

Talking to a person isn't transactional. When you brief a human through steps, they start moving on step one while you're still talking. Every voice agent today waits for end-of-utterance, then thinks, then acts. Dispatch is the missing middle: **continuous partial commitment** — act on what's already unambiguous, amend when the speaker refines it.

Built at Agent Forge (AI Builders × SMU AI Club), June 2026.
