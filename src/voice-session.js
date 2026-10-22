(function initVoiceSession(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XixiVoice = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function createSession() {
    return {
      status: 'idle',
      responseActive: false,
      responseId: '',
      pendingAssistant: '',
      discardAssistantResponse: false,
      discardedResponseIds: new Set(),
      seenUserItems: new Set(),
      seenAssistantResponses: new Set()
    };
  }

  function cloneSession(session) {
    const source = session || createSession();
    return {
      ...source,
      discardedResponseIds: new Set(source.discardedResponseIds || []),
      seenUserItems: new Set(source.seenUserItems || []),
      seenAssistantResponses: new Set(source.seenAssistantResponses || [])
    };
  }

  function applyEvent(currentSession, event) {
    const session = cloneSession(currentSession);
    const result = { session, addUser: '', addAssistant: '', interrupted: false };
    const type = String(event?.type || '');

    if (type === 'session.updated') {
      session.status = 'listening';
      return result;
    }

    if (type === 'input_audio_buffer.speech_started') {
      const shouldInterrupt = session.responseActive || session.status === 'speaking';
      session.status = 'listening';
      if (shouldInterrupt) {
        if (session.responseId) session.discardedResponseIds.add(session.responseId);
        session.pendingAssistant = '';
        session.responseActive = false;
        session.discardAssistantResponse = true;
        result.interrupted = true;
      }
      return result;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      session.status = 'thinking';
      return result;
    }

    if (type === 'response.created') {
      session.responseActive = true;
      session.responseId = String(event?.response?.id || event?.response_id || '');
      session.pendingAssistant = '';
      session.discardAssistantResponse = false;
      session.status = 'speaking';
      return result;
    }

    if (type === 'response.audio_transcript.delta') {
      if (!session.discardAssistantResponse) {
        session.pendingAssistant += String(event?.delta || '');
      }
      session.status = 'speaking';
      return result;
    }

    if (type === 'response.audio_transcript.done') {
      const responseId = String(event?.response_id || session.responseId || '');
      const transcript = String(event?.transcript || session.pendingAssistant || '').trim();
      const discarded =
        session.discardAssistantResponse || session.discardedResponseIds.has(responseId);
      session.pendingAssistant = '';

      if (discarded || !transcript || !responseId || session.seenAssistantResponses.has(responseId)) {
        return result;
      }

      session.seenAssistantResponses.add(responseId);
      result.addAssistant = transcript;
      return result;
    }

    if (type === 'response.done') {
      session.status = 'listening';
      session.responseActive = false;
      session.responseId = '';
      session.pendingAssistant = '';
      session.discardAssistantResponse = false;
      return result;
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = String(event?.transcript || '').trim();
      const itemId = String(event?.item_id || transcript);
      if (!transcript || !itemId || session.seenUserItems.has(itemId)) {
        return result;
      }
      session.seenUserItems.add(itemId);
      result.addUser = transcript;
    }

    return result;
  }

  function buildSessionUpdate(instructions) {
    return {
      modalities: ['text', 'audio'],
      instructions: String(instructions || '').slice(0, 2600),
      audio: {
        input: {
          format: {
            type: 'pcm',
            sample_rate: 16000
          }
        },
        output: {
          voice: 'Tina',
          format: {
            type: 'pcm',
            sample_rate: 24000
          }
        }
      },
      input_audio_transcription: {
        model: 'qwen3-asr-flash-realtime'
      },
      turn_detection: {
        type: 'semantic_vad',
        threshold: 0.5,
        silence_duration_ms: 800
      }
    };
  }

  function normalizeTranscript(value) {
    return String(value || '')
      .replace(/[\s，。！？、,.!?：:；;]/g, '')
      .toLowerCase();
  }

  function appendTranscriptOnce(messages, entry, now = Date.now()) {
    const history = Array.isArray(messages) ? messages : [];
    const itemId = String(entry?.itemId || '');
    const content = String(entry?.content || '').trim();
    const role = entry?.role === 'assistant' ? 'assistant' : 'user';
    const last = history.at(-1);
    const previousText = normalizeTranscript(last?.content);
    const nextText = normalizeTranscript(content);
    const isDuplicateBeforeReply = last?.role === 'user' && role === 'user' && previousText === nextText;
    const isPartialDuplicateBeforeReply =
      last?.role === 'user' &&
      role === 'user' &&
      Number.isFinite(last?.voiceCreatedAt) &&
      now - last.voiceCreatedAt < 8000 &&
      previousText.length > 0 &&
      nextText.length > 0 &&
      (previousText.includes(nextText) || nextText.includes(previousText));
    const isRapidDuplicate =
      last?.role === role &&
      last?.content === content &&
      Number.isFinite(last?.voiceCreatedAt) &&
      now - last.voiceCreatedAt < 4000;

    if (
      !content ||
      isDuplicateBeforeReply ||
      isPartialDuplicateBeforeReply ||
      isRapidDuplicate ||
      (itemId && history.some((message) => message.voiceItemId === itemId))
    ) {
      return history;
    }

    return [
      ...history,
      {
        id: entry?.id || `voice-${now}-${Math.random().toString(36).slice(2)}`,
        role,
        content,
        voiceItemId: itemId || undefined,
        voiceCreatedAt: now
      }
    ];
  }

  return { createSession, applyEvent, appendTranscriptOnce, buildSessionUpdate };
});
