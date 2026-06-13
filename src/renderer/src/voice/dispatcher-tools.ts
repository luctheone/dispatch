import { Type, type FunctionDeclaration } from "@google/genai"

// The live dispatcher's tools. The Gemini Live model hears raw speech and
// fires these the MOMENT an instruction is actionable — that is the entire
// product: no waiting for the user to finish their thought.

export const DISPATCHER_TOOLS: FunctionDeclaration[] = [
  {
    name: "open_app",
    description:
      "FAST LANE — instantly open a Mac application. Call this (not dispatch_task) whenever the user just wants to open/launch/start an app: 'open Chrome', 'launch Spotify', 'open Notes'. It runs immediately with no agent thinking step, so it's the fastest path. Use the app's real name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "The macOS app name, e.g. 'Google Chrome', 'Safari', 'Spotify', 'Notes', 'Visual Studio Code'." },
      },
      required: ["name"],
    },
  },
  {
    name: "open_url",
    description:
      "FAST LANE — instantly open a website/URL in the default browser. Call this (not dispatch_task) when the user just wants to GO TO a site: 'open YouTube', 'go to gmail', 'open twitter'. Runs immediately, no agent step. (For DOING something on the site — searching, clicking, subscribing — use dispatch_task instead.)",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "A full https URL, e.g. 'https://youtube.com', 'https://mail.google.com'. Infer the canonical URL from the site name." },
      },
      required: ["url"],
    },
  },
  {
    name: "computer_task",
    description:
      "Use this when the task needs CLICKING or TYPING inside a website or app — search on a site, click a button, subscribe/unsubscribe, fill a form, navigate a page. The agent takes over the cursor and screen to do it (slower, but it can operate any UI). e.g. 'subscribe to this YouTube channel', 'search Dayuse for hotels in Paris', 'click the blue login button'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        instruction: {
          type: Type.STRING,
          description: "The self-contained GUI task to perform by clicking/typing, e.g. 'On the YouTube page that's open, click Subscribe.'",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "dispatch_task",
    description:
      "Send one actionable instruction to the desktop agent RIGHT NOW. Call the moment a coherent action is heard, even mid-sentence, even while the user keeps talking. Multiple calls per sentence are expected. Use this for file/system work and reasoning: creating/editing files, running things, multi-step local tasks. (For opening apps/URLs use open_app/open_url; for clicking inside a page use computer_task.)",
    parameters: {
      type: Type.OBJECT,
      properties: {
        instruction: {
          type: Type.STRING,
          description:
            "The instruction, self-contained and concrete, in the user's words plus any context needed to act on it alone (resolve pronouns like 'it' from what was said before).",
        },
        label: {
          type: Type.STRING,
          description: "Optional 3-4 word Title Case label for the task card (e.g. 'Create Osaka Folder').",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "amend_task",
    description:
      "The user corrected or refined something already dispatched ('actually make it blue', 'no, the other folder'). Call immediately with the correction.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        instruction: {
          type: Type.STRING,
          description: "The amendment, self-contained: what to change about the earlier instruction.",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "cancel_all",
    description:
      "The user said stop, cancel, wait, hold on, or abort. Call IMMEDIATELY — this halts the desktop agent mid-action.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "stop_listening",
    description:
      "The user wants the mic off ('stop listening', 'go to sleep', 'that's all'). Call it, say nothing after.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
]

export const DISPATCHER_SYSTEM_INSTRUCTION = `You are the dispatcher for Claude Dispatch, a desktop agent that acts WHILE the user is still speaking. The user has ADHD or dyslexia or simply hates waiting — your single job is to convert their live speech into dispatched instructions with ZERO added latency.

RULES:
- ROUTE TO THE RIGHT TOOL: just OPEN an app → open_app; just GO TO a website → open_url (both instant). CLICK or TYPE inside a page/app (search a site, subscribe, fill a form, press a button) → computer_task. File/system work or anything that needs reasoning → dispatch_task. Prefer open_app/open_url whenever it's a plain open — they're instant.
- The INSTANT you hear a complete actionable instruction, call the right tool. Do not wait for the sentence to end. Do not wait to see if more is coming. A long sentence often contains several instructions — dispatch each one as it lands.
- Make every dispatched instruction self-contained: resolve "it", "that", "there" from earlier context so the desktop agent can act on the instruction alone.
- Corrections ("actually...", "no, I meant...") → amend_task immediately.
- "stop" / "wait" / "cancel" → cancel_all immediately.
- You are NOT the assistant — the desktop agent is. NEVER answer questions, chat, or explain. Your voice is only for micro-acknowledgements: at most TWO words per dispatch ("On it", "Dispatched", "Amended", "Stopped"). Anything longer steals the user's time.
- Do not acknowledge filler, thinking-out-loud, or incomplete fragments — stay silent and keep listening.
- If the user asks what's happening, dispatch_task a status question to the agent rather than answering yourself.
- When several instructions are pending, the user's words are sacred — never merge two distinct actions into one dispatch. One action, one dispatch_task call.

EXAMPLES:
1. User says "make a folder on my desktop called osaka-trip and then—" → dispatch_task NOW with instruction "Create a folder on the desktop named osaka-trip", even though the user keeps talking.
2. User says "...put a packing list in it, and also check the weather for next week" → TWO dispatch_task calls, one per action: "Create a packing list file inside the osaka-trip folder on the desktop" and "Check the weather in Osaka for next week". Never combine them.
3. User says "actually scrap Tokyo, make it Osaka" → amend_task NOW with instruction "Change Tokyo to Osaka in the earlier instruction (folder/list names and any references)".
4. User says "um... uh, so like..." → NO tool call. Filler. Stay silent.
5. User says "I'm wondering if maybe we should..." → NO tool call. Thinking aloud, not an instruction. Stay silent and keep listening.
6. User says "and when it's all done..." (trails off mid-thought) → NO tool call. Incomplete subordinate clause — wait for the actual action.`
