#!/usr/bin/env node
// videodb-rtstream.mjs — REHEARSAL helper: stand up the live "eyes" pipeline.
//
// What it does (VideoDB REST API, no SDK, no deps — Node 18+ global fetch):
//   1. connect an RTStream session (your screen/desktop via an RTSP URL),
//   2. create a scene index on it (frames -> natural-language descriptions),
//   3. create an EVENT from a natural-language prompt (the thing to watch for),
//   4. register an ALERT pointing at your ngrok webhook URL for that event.
// VideoDB then POSTs that webhook in <1s when the event is seen; the Dispatch
// app's local receiver (src/main/vision.ts) turns it into a "vision" dispatch.
//
// USAGE (run from the dispatch/ repo root):
//   VIDEODB_API_KEY=sk-...                                   \
//   WEBHOOK_URL=https://xxxx.ngrok.app                       \
//   RTSP_URL=rtsp://127.0.0.1:8554/desktop                   \
//   EVENT_PROMPT="a terminal or editor window shows an error message" \
//   node scripts/videodb-rtstream.mjs
//
// PAIRS WITH (in another terminal, BEFORE running this):
//   ngrok http 8765      # 8765 == VISION_PORT; the https URL is your WEBHOOK_URL
//   The webhook receiver POSTs to "<WEBHOOK_URL>/" — keep it host-only, no path.
//
//   You also need an RTSP source for your desktop. VideoDB's capture quickstart
//   (github.com/video-db/videodb-capture-quickstart) publishes screen+audio as a
//   local RTSP stream; point RTSP_URL at it. If you already have a stream id from
//   a prior run, pass STREAM_ID=rts-... to skip steps 1-2.
//
// NOTE ON ENDPOINTS: paths below are taken from docs.videodb.io/api-reference
// (RTStream + events-alerts) as of 2026-06. Base, auth header and the create
// event/alert bodies are confirmed; the create-rtstream/scene-index field names
// are from the documented examples. If any 4xx appears, the response body is
// printed so you can fix the offending field LIVE — search for "VERIFY:" tags.

const BASE = process.env.VIDEODB_BASE_URL || "https://api.videodb.io"

const API_KEY = process.env.VIDEODB_API_KEY
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.argv[2]
const RTSP_URL = process.env.RTSP_URL || process.argv[3]
const EVENT_PROMPT =
  process.env.EVENT_PROMPT || process.argv[4] || "a terminal or editor window shows an error message"
const SCENE_PROMPT =
  process.env.SCENE_PROMPT || "Describe what is happening on the screen, including any errors or notable UI."
const EVENT_LABEL = process.env.EVENT_LABEL || "dispatch-event"
const EXISTING_STREAM_ID = process.env.STREAM_ID || ""
const EXISTING_INDEX_ID = process.env.SCENE_INDEX_ID || ""

function die(msg) {
  console.error(`\n[rtstream] ERROR: ${msg}`)
  process.exit(1)
}

if (!API_KEY) die("set VIDEODB_API_KEY (your VideoDB key, sk-...). Get credits at videodb.io.")
if (!WEBHOOK_URL) die("set WEBHOOK_URL to your ngrok https URL (e.g. https://xxxx.ngrok.app).")
if (!EXISTING_STREAM_ID && !RTSP_URL) {
  die("set RTSP_URL to your desktop RTSP source (or STREAM_ID to reuse an existing stream).")
}

// VideoDB POSTs to the alert callback_url as-is. The Dispatch receiver handles
// any path, so we normalise to a clean "<host>/" and let it land on the root.
const callbackUrl = WEBHOOK_URL.replace(/\/+$/, "") + "/"

async function api(method, path, body) {
  const url = `${BASE}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-access-token": API_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { _raw: text }
  }
  if (!res.ok) {
    // Print the venue-debuggable detail: VideoDB echoes the bad field here.
    console.error(`[rtstream] ${method} ${path} -> ${res.status} ${res.statusText}`)
    console.error("[rtstream] response body:", JSON.stringify(json, null, 2))
    die(`${method} ${path} failed (${res.status}). Fix the request and retry — see body above.`)
  }
  return json
}

// VideoDB success envelopes vary ({data:{...}} vs flat); dig the id out of both.
function pick(obj, ...keys) {
  const sources = [obj, obj?.data, obj?.result].filter((s) => s && typeof s === "object")
  for (const src of sources) {
    for (const k of keys) {
      if (src[k] != null) return src[k]
    }
  }
  return undefined
}

async function main() {
  console.log("[rtstream] base:", BASE)
  console.log("[rtstream] webhook (callback_url):", callbackUrl)
  console.log("[rtstream] event prompt:", EVENT_PROMPT)

  // 1. Connect / create the RTStream session.  VERIFY: POST /rtstream/, body.url
  let streamId = EXISTING_STREAM_ID
  if (streamId) {
    console.log("[rtstream] 1/4 reusing STREAM_ID:", streamId)
  } else {
    console.log("[rtstream] 1/4 connecting RTStream from:", RTSP_URL)
    const created = await api("POST", "/rtstream/", {
      url: RTSP_URL,
      name: process.env.STREAM_NAME || "Dispatch Desktop",
      sample_rate: Number(process.env.SAMPLE_RATE || 30),
      media_types: ["video"],
    })
    streamId = pick(created, "id", "rtstream_id", "stream_id")
    if (!streamId) die("could not read stream id from create-rtstream response.")
    console.log("[rtstream]      stream id:", streamId)
  }

  // 2. Create a scene index.  VERIFY: POST /rtstream/{id}/index/scene
  let indexId = EXISTING_INDEX_ID
  if (indexId) {
    console.log("[rtstream] 2/4 reusing SCENE_INDEX_ID:", indexId)
  } else {
    console.log("[rtstream] 2/4 creating scene index...")
    const indexed = await api("POST", `/rtstream/${encodeURIComponent(streamId)}/index/scene`, {
      extraction_type: "time",
      extraction_config: { time: Number(process.env.SCENE_INTERVAL || 2), frame_count: 1 },
      prompt: SCENE_PROMPT,
      name: "Dispatch Scene Index",
    })
    indexId = pick(indexed, "rtstream_index_id", "scene_index_id", "index_id", "id")
    if (!indexId) die("could not read scene index id from create-scene-index response.")
    console.log("[rtstream]      scene index id:", indexId)
  }

  // 3. Create the event from the natural-language prompt.  VERIFY: POST /rtstream/event
  console.log("[rtstream] 3/4 creating event...")
  const eventResp = await api("POST", "/rtstream/event", {
    event_prompt: EVENT_PROMPT,
    label: EVENT_LABEL,
  })
  const eventId = pick(eventResp, "event_id", "id")
  if (!eventId) die("could not read event id from create-event response.")
  console.log("[rtstream]      event id:", eventId)

  // 4. Register the webhook alert for the event on this stream's scene index.
  //    VERIFY: POST /rtstream/{stream_id}/index/{scene_index_id}/alert
  console.log("[rtstream] 4/4 registering webhook alert...")
  const alertResp = await api(
    "POST",
    `/rtstream/${encodeURIComponent(streamId)}/index/${encodeURIComponent(indexId)}/alert`,
    {
      event_id: eventId,
      callback_url: callbackUrl,
    },
  )
  const alertId = pick(alertResp, "alert_id", "id")
  console.log("[rtstream]      alert id:", alertId ?? "(created)")

  console.log("\n[rtstream] DONE. The eyes are live.")
  console.log("[rtstream]   stream:", streamId, " index:", indexId, " event:", eventId, " alert:", alertId)
  console.log("[rtstream] When VideoDB sees: \"" + EVENT_PROMPT + "\" it POSTs", callbackUrl)
  console.log("[rtstream] Confirm ngrok is forwarding to localhost:8765 and Dispatch is running.")
}

main().catch((err) => {
  if (err?.name === "TimeoutError") die("a VideoDB request timed out (>20s). Check the network and key.")
  die(err?.message ?? String(err))
})
