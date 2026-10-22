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
