# Voice Mode flows

End-to-end scenarios for the Voice Mode extension, right-side panel, OpenWork UI MCP controls, and optional OpenAI Realtime audio path.

## Preflight

1. Start Electron with CDP:
   ```bash
   OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=9823 pnpm dev
   ```
2. List targets:
   ```
   browser_list({ browser_url: "http://127.0.0.1:9823" })
   ```
3. Enable control mode:
   ```js
   window.__openworkControl.setEnabled(true)
   ```

## Flow 1 — Extension opens the Voice panel

Steps:
1. Open or create a session.
2. Execute `voice.panel.open` through `window.__openworkControl.execute`.
3. Read `window.__openwork.slice("voice")`.

Pass criteria:
- The right rail shows a Voice Mode button when the Voice Mode extension is enabled.
- The Voice panel opens on the right side.
- The `voice` inspector slice exists with `status: "idle"`.
- `ui_assert` can assert `slice: "voice", path: "status", equals: "idle"`.

## Flow 2 — Deterministic transcript injection

Steps:
1. Open Voice Mode with `voice.panel.open`.
2. Execute:
   ```js
   window.__openworkControl.execute("voice.inject_transcript", {
     text: "Summarize this repo and put the next step in the composer."
   })
   ```
3. Wait with UI MCP:
   ```json
   { "slice": "voice", "path": "latestUserTranscript", "contains": "Summarize this repo" }
   ```
4. Assert the composer slice contains the same draft.

Pass criteria:
- Voice timeline shows the injected user transcript.
- `window.__openwork.slice("composer").draft` contains the injected text.
- No OpenAI credentials or microphone are required for this flow.

## Flow 3 — Optional OpenAI Realtime voice path

Start Electron with fake media for repeatable microphone input:

```bash
OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=9823 \
ELECTRON_EXTRA_LAUNCH_ARGS="--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=/absolute/path/sample.wav" \
pnpm dev
```

Ensure `OPENAI_API_KEY` or `OPENAI_REALTIME_API_KEY` is saved in OpenWork Environment Variables, or set `OPENWORK_OPENAI_REALTIME_API_KEY` in the launching shell.

Steps:
1. Open Voice Mode.
2. Execute `voice.start`.
3. Use `ui_wait_for` with `slice: "voice", path: "connected", equals: true`.
4. Let the fake audio run, then wait for `latestUserTranscript` to become non-empty.
5. Execute `voice.stop`.

Pass criteria:
- Voice status reaches `listening` or `speaking`.
- The transcript appears in the Voice timeline.
- Tool calls route through OpenWork actions (`openwork_snapshot`, `openwork_list_actions`, `openwork_execute_action`), not screen coordinates.
- `voice.stop` returns the panel to `idle`.

## Flow 4 — Realtime data-channel tool call

Use this when microphone capture is unavailable but an OpenAI key is present. It still exercises the real Realtime WebRTC/data-channel path and OpenWork tool invocation.

Steps:
1. Open Voice Mode.
2. Execute `voice.start` and wait for `slice: "voice", path: "connected", equals: true`.
3. Execute `voice.send_text` with:
   ```json
   { "text": "Use the OpenWork UI action composer.set_text to put exactly REAL VOICE EVAL PASSED in the composer. Do it now." }
   ```
4. Wait for `slice: "composer", path: "draft", equals: "REAL VOICE EVAL PASSED"`.

Pass criteria:
- Voice timeline shows a user command, an `openwork_execute_action` tool row, and an assistant response.
- Composer draft equals `REAL VOICE EVAL PASSED`.

## Flow 5 — Deterministic audio-buffer transcription

Use this when Chromium fake microphone flags are silent in Electron. Convert a short speech fixture to raw PCM16 mono and inject it through the Realtime input buffer:

```bash
say -o /tmp/hello-world.aiff "hello world"
ffmpeg -y -i /tmp/hello-world.aiff -ac 1 -ar 24000 -f s16le -c:a pcm_s16le /tmp/hello-world.pcm
```

Steps:
1. Open Voice Mode.
2. Execute `voice.start` and wait for `connected: true`.
3. Base64-encode `/tmp/hello-world.pcm` and execute `voice.inject_audio` with `{ "pcm16Base64": "..." }`.
4. Wait for a new `voice.timeline` user entry containing `hello`.

Pass criteria:
- The audio buffer produces a Realtime transcription such as `Hello world.`.
- Punctuation-only transcription fragments do not overwrite the last meaningful transcript.

## Flow 6 — Voice survives session creation

This catches regressions where Voice Mode is treated like a session-owned artifact panel and gets unmounted when the route changes.

Steps:
1. Open an existing session.
2. Execute `voice.panel.open`.
3. Execute `voice.send_text` with:
   ```json
   { "text": "Use the OpenWork UI action session.create_task to create a new session. After the new session opens, use composer.set_text to put exactly VOICE SESSION SURVIVED in the composer." }
   ```
4. Wait for the `route.selectedSessionId` value to change.
5. Wait for `slice: "voice", path: "connected", equals: true`.
6. Wait for `slice: "composer", path: "draft", equals: "VOICE SESSION SURVIVED"`.

Pass criteria:
- The right-side Voice Mode panel remains open after the new session route loads.
- The Realtime session remains connected.
- The model can execute a second UI action in the new session.
- Composer draft in the new session equals `VOICE SESSION SURVIVED`.
