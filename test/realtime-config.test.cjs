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

  assert.equal(answer, 'answer-sdp\r\n');
  assert.equal(request.url, 'https://example.com/realtime?model=model-a');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.equal(request.options.body, 'offer-sdp');
});

test('normalizes an SDP answer to CRLF with a trailing line ending', async () => {
  const answer = await exchangeRealtimeSdp(
    {
      available: true,
      apiKey: 'secret',
      model: 'model-a',
      url: 'https://example.com/realtime?model=model-a'
    },
    'offer-sdp',
    async () => new Response('v=0\na=setup:passive', { status: 200 })
  );

  assert.equal(answer, 'v=0\r\na=setup:passive\r\n');
});
