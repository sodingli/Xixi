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
  assert.equal(result.session.discardAssistantResponse, true);
});

test('speech start while idle does not interrupt', () => {
  const session = voice.createSession();
  session.status = 'listening';
  const result = voice.applyEvent(session, { type: 'input_audio_buffer.speech_started' });
  assert.equal(result.interrupted, false);
  assert.equal(result.session.status, 'listening');
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
  session.responseId = 'response-cancelled';
  const interrupted = voice.applyEvent(session, { type: 'input_audio_buffer.speech_started' });
  const result = voice.applyEvent(interrupted.session, {
    type: 'response.audio_transcript.done',
    response_id: 'response-cancelled',
    transcript: '不应该显示'
  });
  assert.equal(result.addAssistant, '');
});

test('appendTranscriptOnce preserves messages and ignores duplicate item ids', () => {
  const messages = [{ id: '1', role: 'assistant', content: '你好' }];
  const once = voice.appendTranscriptOnce(messages, {
    role: 'user',
    content: '我在',
    itemId: 'voice-user-1'
  });
  const twice = voice.appendTranscriptOnce(once, {
    role: 'user',
    content: '我在',
    itemId: 'voice-user-1'
  });

  assert.notEqual(once, messages);
  assert.equal(messages.length, 1);
  assert.equal(once.length, 2);
  assert.equal(twice.length, 2);
  assert.equal(twice[1].voiceItemId, 'voice-user-1');
});

test('builds a realtime session update with transcription and semantic VAD', () => {
  const update = voice.buildSessionUpdate('你是皙皙，请简短回答。');
  assert.deepEqual(update.modalities, ['text', 'audio']);
  assert.equal(update.audio.output.voice, 'Tina');
  assert.equal(update.input_audio_transcription.model, 'qwen3-asr-flash-realtime');
  assert.equal(update.turn_detection.type, 'semantic_vad');
  assert.equal(update.turn_detection.silence_duration_ms, 800);
  assert.equal(update.instructions, '你是皙皙，请简短回答。');
});

test('late assistant transcript after interruption and response.done stays discarded', () => {
  const session = voice.createSession();
  session.status = 'speaking';
  session.responseActive = true;
  session.responseId = 'response-late';
  const interrupted = voice.applyEvent(session, { type: 'input_audio_buffer.speech_started' });
  const done = voice.applyEvent(interrupted.session, { type: 'response.done' });
  const late = voice.applyEvent(done.session, {
    type: 'response.audio_transcript.done',
    response_id: 'response-late',
    transcript: '迟到的不完整回复'
  });

  assert.equal(late.addAssistant, '');
});

test('speech start while thinking without an active response does not cancel', () => {
  const session = voice.createSession();
  session.status = 'thinking';
  session.responseActive = false;
  const result = voice.applyEvent(session, { type: 'input_audio_buffer.speech_started' });
  assert.equal(result.interrupted, false);
  assert.equal(result.session.status, 'listening');
});

test('suppresses rapid duplicate voice transcripts with different item ids', () => {
  const messages = [];
  const first = voice.appendTranscriptOnce(messages, {
    role: 'user',
    content: '今天有点累',
    itemId: 'voice-user-1'
  }, 1000);
  const duplicate = voice.appendTranscriptOnce(first, {
    role: 'user',
    content: '今天有点累',
    itemId: 'voice-user-2'
  }, 2500);
  const later = voice.appendTranscriptOnce(duplicate, {
    role: 'user',
    content: '今天有点累',
    itemId: 'voice-user-3'
  }, 20_000);

  assert.equal(first.length, 1);
  assert.equal(duplicate.length, 1);
  assert.equal(later.length, 1);
});

test('allows the same user phrase again after an assistant reply', () => {
  const withReply = [
    { role: 'user', content: '今天有点累', voiceCreatedAt: 1000 },
    { role: 'assistant', content: '先休息一下。', voiceCreatedAt: 2000 }
  ];
  const next = voice.appendTranscriptOnce(withReply, {
    role: 'user',
    content: '今天有点累',
    itemId: 'voice-user-2'
  }, 3000);

  assert.equal(next.length, 3);
});

test('suppresses a partial ASR duplicate before an assistant reply', () => {
  const first = voice.appendTranscriptOnce([], {
    role: 'user',
    content: '嘻嘻，今天有点累，陪我聊两句吧。',
    itemId: 'voice-user-1'
  }, 1000);
  const partial = voice.appendTranscriptOnce(first, {
    role: 'user',
    content: '今天有点累，陪我聊两句吧。',
    itemId: 'voice-user-2'
  }, 3000);

  assert.equal(partial.length, 1);
});
