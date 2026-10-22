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
  return `${selected}

这是实时语音陪伴。请使用自然、简短的口语回应；先承接对方的情绪，再给一个轻量建议。不要使用 Markdown、列表或长篇解释。`;
}

function normalizeSdp(answerSdp) {
  let sdp = String(answerSdp || '').trim().replace(/\r?\n/g, '\r\n');
  if (sdp) sdp += '\r\n';
  return sdp;
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
  if (!response.ok) {
    throw new Error(`Realtime SDP exchange failed: ${response.status} ${body.slice(0, 240)}`);
  }
  if (!body.trim()) throw new Error('Realtime service returned an empty SDP answer.');
  return normalizeSdp(body);
}

module.exports = {
  DEFAULT_REALTIME_MODEL,
  createRealtimeConfig,
  buildRealtimeInstructions,
  normalizeSdp,
  exchangeRealtimeSdp
};
