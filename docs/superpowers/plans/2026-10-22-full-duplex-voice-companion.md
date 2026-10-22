# Full-Duplex Voice Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add click-once, continuously listening voice companionship to 皙皙 with automatic turn detection, spoken replies, interruption, and transcript-backed chat history.

**Architecture:** Renderer owns microphone capture, `RTCPeerConnection`, remote audio playback, and UI state. Electron main process owns API-key-bearing SDP exchange with Qwen-Omni-Realtime. Pure configuration and event-state modules isolate testable behavior from Electron and browser APIs.

**Tech Stack:** Electron 37, browser WebRTC/MediaDevices, Alibaba Cloud Qwen-Omni-Realtime WebRTC, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-22-full-duplex-voice-companion-design.md`

## Global Constraints

- Microphone stays off until the user clicks the voice button.
- Voice remains active until the user clicks again, hides the window, or quits.
- Do not expose `OPENAI_API_KEY`/`XIXI_API_KEY` to renderer code, logs, or chat content.
- Use default model `qwen3.8-omni-flash-realtime`.
- Read `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_URL`; derive the WebRTC URL from `OPENAI_BASE_URL` when the override is absent.
- Keep existing text chat, reminders, camera emotion recognition, and persona behavior working.
- Do not upload camera video as part of this feature.
- Preserve ASCII source defaults; Chinese UI text is intentional.

---

### Task 1: Realtime configuration and SDP proxy

**Files:**
- Create: `electron/realtime-config.cjs`
- Test: `test/realtime-config.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createRealtimeConfig(env) -> { available, reason, apiKey, model, url }`
- Produces: `buildRealtimeInstructions(persona, fallbackPersona) -> string`
- Produces: `exchangeRealtimeSdp(config, offerSdp, fetchImpl) -> Promise<string>`
- Produces IPC: `voice:get-config`, `voice:exchange-sdp`

- [ ] **Step 1: Write failing configuration tests**

Create `test/realtime-config.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRealtimeConfig,
  buildRealtimeInstructions,
  exchangeRealtimeSdp
} = require('../electron/realtime-config.cjs');

test('derives the WebRTC endpoint from a workspace base URL', () => {
  const config = createRealtimeConfig({
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'https://llm-demo.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  });

  assert.equal(config.available, true);
  assert.equal(
    config.url,
    'https://llm-demo.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime'
  );
});

test('reports missing API key without exposing a URL', () => {
  const config = createRealtimeConfig({ OPENAI_BASE_URL: 'https://llm-demo.example.com' });
  assert.deepEqual(config, {
    available: false,
    reason: 'missing-api-key',
    apiKey: '',
    model: 'qwen3.8-omni-flash-realtime',
    url: ''
  });
});

test('appends spoken-companion rules to the selected persona', () => {
  const text = buildRealtimeInstructions('你叫皙皙，语气温柔。', 'fallback');
  assert.match(text, /你叫皙皙，语气温柔。/);
  assert.match(text, /口语/);
  assert.match(text, /简短/);
});

test('exchanges SDP through an authenticated request', async () => {
  let request;
  const answer = await exchangeRealtimeSdp(
    {
      available: true,
      apiKey: 'secret',
      model: 'model-a',
      url: 'https://example.com/realtime?model=model-a'
    },
    'offer-sdp',
    async (url, options) => {
      request = { url, options };
      return new Response('answer-sdp', { status: 200 });
    }
  );

  assert.equal(answer, 'answer-sdp');
  assert.equal(request.url, 'https://example.com/realtime?model=model-a');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.equal(request.options.body, 'offer-sdp');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/realtime-config.test.cjs`

Expected: FAIL because `electron/realtime-config.cjs` does not exist.

- [ ] **Step 3: Implement the realtime configuration module**

Create `electron/realtime-config.cjs` with:

```js
const DEFAULT_REALTIME_MODEL = 'qwen3.8-omni-flash-realtime';

function createRealtimeConfig(env = process.env) {
  const apiKey = env.OPENAI_API_KEY || env.XIXI_API_KEY || '';
  const model = env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const override = String(env.OPENAI_REALTIME_URL || '').trim();
  let url = override;

  if (apiKey && !url) {
    try {
      const base = new URL(env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
      const endpoint = new URL('/api/v1/webrtc/realtime', base.origin);
      endpoint.searchParams.set('model', model);
      url = endpoint.toString();
    } catch {
      url = '';
    }
  }

  return {
    available: Boolean(apiKey && url),
    reason: !apiKey ? 'missing-api-key' : url ? '' : 'invalid-realtime-url',
    apiKey,
    model,
    url
  };
}

function buildRealtimeInstructions(persona, fallbackPersona) {
  const selected = String(persona || fallbackPersona || '').trim().slice(0, 2000);
  return `${selected}\n\n这是实时语音陪伴。请使用自然、简短的口语回应；先承接对方的情绪，再给一个轻量建议。不要使用 Markdown、列表或长篇解释。`;
}

async function exchangeRealtimeSdp(config, offerSdp, fetchImpl = fetch) {
  if (!config?.available) throw new Error(config?.reason || 'realtime-unavailable');
  if (!String(offerSdp || '').trim()) throw new Error('missing-offer-sdp');

  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/sdp'
    },
    body: String(offerSdp)
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Realtime SDP exchange failed: ${response.status} ${body.slice(0, 240)}`);
  if (!body.trim()) throw new Error('Realtime service returned an empty SDP answer.');
  return body.trim();
}

module.exports = { DEFAULT_REALTIME_MODEL, createRealtimeConfig, buildRealtimeInstructions, exchangeRealtimeSdp };
```

- [ ] **Step 4: Run tests and verify pass**

Run: `node --test test/realtime-config.test.cjs`

Expected: PASS, 4 tests.

- [ ] **Step 5: Integrate IPC without exposing the key**

In `electron/main.cjs`, require the module and register:

```js
const { createRealtimeConfig, buildRealtimeInstructions, exchangeRealtimeSdp } = require('./realtime-config.cjs');
```

`voice:get-config` receives the current renderer persona and returns `{ available, reason, model, instructions }` only. `instructions` is built in the main process with `buildRealtimeInstructions(persona, getDefaultPersona())`, and neither `apiKey` nor `url` is returned. `voice:exchange-sdp` calls `exchangeRealtimeSdp(createRealtimeConfig(process.env), offerSdp)` and returns `{ ok: true, sdp }` or `{ ok: false, error }`. Expose `getVoiceConfig(persona)` and `exchangeVoiceSdp(offerSdp)` in `electron/preload.cjs`.

Add `"test": "node --test test"` to `package.json`.

- [ ] **Step 6: Verify main and preload parse**

Run: `node --check electron/main.cjs && node --check electron/preload.cjs && node --test test/realtime-config.test.cjs`

Expected: all commands succeed.

- [ ] **Step 7: Commit**

```bash
git add electron/realtime-config.cjs electron/main.cjs electron/preload.cjs package.json test/realtime-config.test.cjs
git commit -m "feat: add realtime voice configuration proxy"
```

---

### Task 2: Voice-session state and transcript deduplication

**Files:**
- Create: `src/voice-session.js`
- Test: `test/voice-session.test.cjs`
- Modify: `src/index.html`
- Modify: `src/app.js`

**Interfaces:**
- Produces global `window.XixiVoice`
- Produces: `createSession() -> voice state`
- Produces: `applyEvent(session, event) -> { session, addUser, addAssistant, interrupted }`
- Produces: `appendTranscriptOnce(messages, entry) -> messages`
- Transcript entry: `{ role, content, itemId }`
- Events use service event names directly; unsupported events are no-ops.

- [ ] **Step 1: Write failing state tests**

Create `test/voice-session.test.cjs` covering:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../src/voice-session.js');

test('speech start interrupts an active response', () => {
  const session = voice.createSession();
  session.status = 'speaking';
  session.pendingAssistant = 'half reply';
  session.responseActive = true;

  const result = voice.applyEvent(session, { type: 'input_audio_buffer.speech_started' });

  assert.equal(result.interrupted, true);
  assert.equal(result.session.status, 'listening');
  assert.equal(result.session.pendingAssistant, '');
  assert.equal(result.session.responseActive, false);
});

test('completed user transcript is emitted once', () => {
  const session = voice.createSession();
  const event = {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'user-1',
    transcript: '今天有点累'
  };
  const first = voice.applyEvent(session, event);
  const second = voice.applyEvent(first.session, event);

  assert.equal(first.addUser, '今天有点累');
  assert.equal(second.addUser, '');
});

test('completed assistant transcript is emitted once', () => {
  const session = voice.createSession();
  const event = {
    type: 'response.audio_transcript.done',
    response_id: 'response-1',
    transcript: '先休息一下。'
  };
  const first = voice.applyEvent(session, event);
  const second = voice.applyEvent(first.session, event);

  assert.equal(first.addAssistant, '先休息一下。');
  assert.equal(second.addAssistant, '');
});

test('cancelled assistant transcript is not emitted', () => {
  const session = voice.createSession();
  session.status = 'speaking';
  session.responseActive = true;
  voice.applyEvent(session, { type: 'input_audio_buffer.speech_started' });
  const result = voice.applyEvent(session, {
    type: 'response.audio_transcript.done',
    response_id: 'response-cancelled',
    transcript: '不应该显示'
  });
  assert.equal(result.addAssistant, '');
});
```

Also test `appendTranscriptOnce` preserves the previous array and ignores duplicate `itemId`.

- [ ] **Step 2: Run test and verify failure**

Run: `node --test test/voice-session.test.cjs`

Expected: FAIL because `src/voice-session.js` does not exist.

- [ ] **Step 3: Implement the pure session module**

Use a UMD-style module that works in both Node and the Electron renderer:

```js
(function initVoiceSession(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XixiVoice = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  // createSession, applyEvent, appendTranscriptOnce
  return { createSession, applyEvent, appendTranscriptOnce };
});
```

`applyEvent` must:

- Return `{ session, addUser: '', addAssistant: '', interrupted: false }`.
- Track `seenUserItems`, `seenAssistantResponses`, `pendingAssistant`, `responseActive`, and `status`.
- Treat speech start during `speaking`/`thinking` as interruption.
- Treat `session.updated` as listening, `speech_stopped` as thinking, `response.created` as speaking, and `response.done` as listening.
- On interruption set `discardAssistantResponse = true`; a later assistant completion for that response must not be emitted.

- [ ] **Step 4: Run test and verify pass**

Run: `node --test test/voice-session.test.cjs`

Expected: PASS.

- [ ] **Step 5: Load the module and connect transcript events**

Add `<script src="./voice-session.js"></script>` before `app.js` in `src/index.html`. In `src/app.js`, on user/assistant transcript events call `appendTranscriptOnce(state.messages, entry)` and save through the existing `saveJson` path. Do not change camera or reminder event handling.

- [ ] **Step 6: Verify syntax and tests**

Run: `node --check src/voice-session.js && node --check src/app.js && node --test test/voice-session.test.cjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/voice-session.js src/index.html src/app.js test/voice-session.test.cjs
git commit -m "feat: add voice session state and transcript dedupe"
```

---

### Task 3: Voice button, WebRTC connection, playback, and interruption

**Files:**
- Modify: `src/index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Test: `test/voice-session.test.cjs`

**Interfaces:**
- Consumes: `window.XixiVoice`, `getVoiceConfig`, `exchangeVoiceSdp`.
- Produces UI element `#voiceToggle` and hidden remote audio element.
- Produces local `startVoiceCompanion`, `stopVoiceCompanion`, `handleVoiceEvent`, `sendVoiceEvent`.

- [ ] **Step 1: Add a failing interruption-state test**

Add a test asserting that `speech_started` after an assistant response is active emits an interruption signal, while `speech_started` in ordinary listening does not. Run it and verify failure before changing the state module.

- [ ] **Step 2: Implement the minimal state change**

Update `src/voice-session.js` so ordinary listening speech start does not interrupt. Run `node --test test/voice-session.test.cjs`; expect PASS.

- [ ] **Step 3: Add the microphone control**

In `src/index.html`, place a microphone button inside `.composer` before the send button, with `id="voiceToggle"`, `type="button"`, `title="语音陪伴"`, and accessible label. Add a hidden `<audio id="voiceAudio" autoplay playsinline></audio>` inside the app.

In `src/styles.css`, make the composer three columns: input, microphone, send. Add `.voice-button.is-listening`, `.voice-button.is-thinking`, `.voice-button.is-speaking`, and `.voice-button.is-error` states. Keep the panel compact and preserve the existing 8px radius.

- [ ] **Step 4: Implement WebRTC lifecycle in app state**

Extend `state` with:

```js
voice: {
  active: false,
  status: 'idle',
  pc: null,
  stream: null,
  channel: null,
  session: null
}
```

Implement:

```js
async function toggleVoiceCompanion()
async function startVoiceCompanion()
function stopVoiceCompanion(reason)
function updateVoiceStatus(status)
function sendVoiceEvent(payload)
async function handleVoiceEvent(event)
```

`startVoiceCompanion` must request `getUserMedia({ audio: true })`, create `RTCPeerConnection`, add the audio track, create the `oai-events` DataChannel, create an Offer, call `exchangeVoiceSdp`, set the remote Answer, wait for `session.created`, then send `session.update` with `modalities: ["text", "audio"]`, voice `Tina`, `semantic_vad`, `silence_duration_ms: 800`, and `instructions` built from the current persona.

Use `pc.ontrack` to assign `event.streams[0]` to `#voiceAudio` and call `play()`. Use `pc.onconnectionstatechange` and `channel.onmessage` to update UI and chat state.

- [ ] **Step 5: Handle the required server events**

Map event names exactly as specified. On interruption:

```js
voiceAudio.pause();
voiceAudio.currentTime = 0;
voiceAudio.muted = true;
sendVoiceEvent({ type: 'response.cancel' });
```

Re-enable audio only when a new response begins, and never leave the microphone track active after `stopVoiceCompanion`. Add a `beforeunload` cleanup and hide-window cleanup.

- [ ] **Step 6: Add browser fallback methods**

Add `getVoiceConfig` and `exchangeVoiceSdp` to `createBrowserFallback()` so opening `index.html` without Electron shows a clear unsupported state instead of throwing.

- [ ] **Step 7: Verify syntax and tests**

Run: `node --check src/app.js && node --check src/voice-session.js && node --check electron/main.cjs && node --check electron/preload.cjs && node --test test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/index.html src/app.js src/styles.css electron/main.cjs electron/preload.cjs test/voice-session.test.cjs
git commit -m "feat: add continuous voice companion UI"
```

---

### Task 4: Installation configuration and live verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `package.json` only if test script is not already present
- Verify: `release/`

- [ ] **Step 1: Document the realtime variables**

Add:

```text
OPENAI_REALTIME_MODEL="qwen3.8-omni-flash-realtime"
# Optional; normally derived from OPENAI_BASE_URL
OPENAI_REALTIME_URL=""
```

Explain that the installed app reads the same user-data `.env.local`, and that microphone audio is sent only after the voice button is enabled.

- [ ] **Step 2: Run the full test and syntax suite**

Run: `node --test test && node --check electron/main.cjs && node --check electron/preload.cjs && node --check src/app.js && node --check src/voice-session.js`

Expected: PASS.

- [ ] **Step 3: Build the app and inspect sensitive content**

Run: `corepack pnpm run dist` and then:

```bash
node node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js list release/mac-arm64/皙皙.app/Contents/Resources/app.asar
```

Expected: contains new voice files, does not contain `.env.local`, `images/`, or the local API key.

- [ ] **Step 4: Manual acceptance check**

In the installed `.app`:

- Click the microphone once and grant permission.
- Speak two separate sentences without clicking again.
- Confirm a text transcript and spoken response for each turn.
- Interrupt a spoken response and confirm playback stops.
- Click the microphone again and confirm the macOS microphone indicator turns off.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md package.json
git commit -m "docs: document realtime voice configuration"
```
