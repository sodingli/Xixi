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
      seenUserItems: new Set(),
      seenAssistantResponses: new Set()
    };
  }

  function cloneSession(session) {
    const source = session || createSession();
    return {
      ...source,
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
      const shouldInterrupt =
        session.responseActive || session.status === 'speaking' || session.status === 'thinking';
      session.status = 'listening';
      if (shouldInterrupt) {
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
      const discarded = session.discardAssistantResponse;
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

  function appendTranscriptOnce(messages, entry) {
    const history = Array.isArray(messages) ? messages : [];
    const itemId = String(entry?.itemId || '');
    const content = String(entry?.content || '').trim();
    if (!content || (itemId && history.some((message) => message.voiceItemId === itemId))) {
      return history;
    }

    return [
      ...history,
      {
        id: entry?.id || `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: entry?.role === 'assistant' ? 'assistant' : 'user',
        content,
        voiceItemId: itemId || undefined
      }
    ];
  }

  return { createSession, applyEvent, appendTranscriptOnce };
});
