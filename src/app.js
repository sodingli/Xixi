const bridge = window.xixi || createBrowserFallback();

const app = document.querySelector('#app');
const windowBar = document.querySelector('.window-bar');
const bubble = document.querySelector('#bubble');
const petButton = document.querySelector('#petButton');
const moodLabel = document.querySelector('#moodLabel');
const modelStatus = document.querySelector('#modelStatus');
const messagesEl = document.querySelector('#messages');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const reminderForm = document.querySelector('#reminderForm');
const reminderText = document.querySelector('#reminderText');
const reminderTime = document.querySelector('#reminderTime');
const reminderList = document.querySelector('#reminderList');
const cameraToggle = document.querySelector('#cameraToggle');
const scanBtn = document.querySelector('#scanBtn');
const cameraPreview = document.querySelector('#cameraPreview');
const cameraCanvas = document.querySelector('#cameraCanvas');
const emotionStatus = document.querySelector('#emotionStatus');
const emotionLabel = document.querySelector('#emotionLabel');
const emotionReason = document.querySelector('#emotionReason');
const configText = document.querySelector('#configText');
const compactBtn = document.querySelector('#compactBtn');
const panelCloseBtn = document.querySelector('#panelCloseBtn');
const pinBtn = document.querySelector('#pinBtn');
const hideBtn = document.querySelector('#hideBtn');
const alwaysTopToggle = document.querySelector('#alwaysTopToggle');
const quietToggle = document.querySelector('#quietToggle');
const personaForm = document.querySelector('#personaForm');
const personaInput = document.querySelector('#personaInput');
const personaResetBtn = document.querySelector('#personaResetBtn');

const DEFAULT_PERSONA =
  '你叫皙皙，是一个桌面悬浮陪伴玩偶。你说中文，语气温柔、轻松、有一点俏皮，但不要油腻。你的目标是陪伴、倾听、提醒和帮助用户整理当下的小事。回答要短一些，优先给情绪承接和一个可执行的小建议。不要声称自己能替代医生或专业咨询。';

const moodText = {
  calm: '平静',
  happy: '开心',
  thinking: '思考',
  tired: '低电量',
  stressed: '紧张',
  focused: '专注',
  surprised: '惊讶',
  sad: '低落',
  neutral: '普通',
  unknown: '观察中'
};

const emotionMoodMap = {
  happy: 'happy',
  calm: 'calm',
  sad: 'sad',
  tired: 'tired',
  stressed: 'stressed',
  surprised: 'surprised',
  focused: 'focused',
  neutral: 'calm',
  unknown: 'thinking'
};

const state = {
  messages: loadJson('xixi:messages', [
    {
      role: 'assistant',
      content: '你好，我是皙皙。今天我先在桌角陪你。'
    }
  ]).map(migrateDisplayName),
  reminders: loadJson('xixi:reminders', []),
  persona: loadJson('xixi:persona', DEFAULT_PERSONA),
  compact: loadJson('xixi:compact', false),
  quiet: loadJson('xixi:quiet', false),
  alwaysTop: loadJson('xixi:alwaysTop', true),
  cameraStream: null,
  emotionTimer: null,
  previousFrame: null,
  faceDetector: null,
  config: null,
  drag: null,
  suppressPetClick: false,
  clickSuppressTimer: 0,
  speakingTimer: 0,
  bubbleTimer: 0,
  controlsTimer: 0
};

init();

async function init() {
  bindEvents();
  renderMessages();
  renderReminders();
  applyCompact(state.compact);
  quietToggle.checked = state.quiet;
  personaInput.value = state.persona;
  alwaysTopToggle.checked = state.alwaysTop;
  await applyAlwaysTop(state.alwaysTop);
  scheduleFutureReminders();
  setReminderDefaultTime();
  scheduleBubbleHide();

  try {
    state.config = await bridge.getConfig();
    updateStatusDetail(state.config.hasApiKey ? '模型陪伴' : '本地陪伴');
    configText.textContent = state.config.hasApiKey
      ? `${state.config.model} / ${state.config.visionModel}`
      : '未配置密钥';
    if (!hasStoredValue('xixi:persona') && state.config.defaultPersona) {
      state.persona = state.config.defaultPersona;
      personaInput.value = state.persona;
    }
  } catch {
    configText.textContent = '读取失败';
  }
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  petButton.addEventListener('click', (event) => {
    if (state.suppressPetClick) {
      event.preventDefault();
      event.stopPropagation();
      state.suppressPetClick = false;
      clearTimeout(state.clickSuppressTimer);
      return;
    }

    const lines = [
      '摸到啦。我现在精神了一点。',
      '在呢，今天也认真陪你。',
      '收到一个轻轻的点名。',
      '我把这一下记成小小的拥抱。'
    ];
    petButton.classList.remove('is-booped');
    requestAnimationFrame(() => petButton.classList.add('is-booped'));
    showWindowControls();
    setMood('happy');
    say(lines[Math.floor(Math.random() * lines.length)]);
  });

  petButton.addEventListener('dblclick', () => {
    applyCompact(!state.compact);
  });

  petButton.addEventListener('pointerenter', showWindowControls);
  petButton.addEventListener('pointerdown', (event) => {
    showWindowControls();
    beginWindowDrag(event);
  });
  bubble.addEventListener('pointerdown', beginWindowDrag);
  windowBar.addEventListener('pointerenter', () => showWindowControls(false));
  windowBar.addEventListener('pointerleave', () => scheduleWindowControlsHide(1600));
  window.addEventListener('pointerup', endWindowDrag);
  window.addEventListener('pointercancel', endWindowDrag);
  window.addEventListener('pointermove', followPointer);
  window.addEventListener('pointermove', updateWindowDrag);
  chatForm.addEventListener('submit', sendChat);
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });

  reminderForm.addEventListener('submit', addReminder);
  cameraToggle.addEventListener('click', toggleCamera);
  scanBtn.addEventListener('click', () => runEmotionScan(true));

  compactBtn.addEventListener('click', () => applyCompact(!state.compact));
  panelCloseBtn.addEventListener('click', () => applyCompact(true));
  pinBtn.addEventListener('click', () => applyAlwaysTop(!state.alwaysTop));
  hideBtn.addEventListener('click', () => bridge.hideWindow());
  alwaysTopToggle.addEventListener('change', () => applyAlwaysTop(alwaysTopToggle.checked));
  quietToggle.addEventListener('change', () => {
    state.quiet = quietToggle.checked;
    saveJson('xixi:quiet', state.quiet);
    say(state.quiet ? '我会轻一点。' : '我恢复正常音量啦。');
  });
  personaForm.addEventListener('submit', savePersona);
  personaResetBtn.addEventListener('click', () => {
    state.persona = state.config?.defaultPersona || DEFAULT_PERSONA;
    personaInput.value = state.persona;
    saveJson('xixi:persona', state.persona);
    say('角色设定已恢复默认。');
  });

  bridge.onReminderDue((reminder) => {
    markReminderDone(reminder.id);
    setMood('happy');
    say(`到点啦：${reminder.message}`);
    addMessage('assistant', `我来提醒你：${reminder.message}`);
  });
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === name);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('is-active', view.id === `${name}View`);
  });
}

function followPointer(event) {
  const rect = petButton.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clamp((event.clientX - centerX) / 30, -3, 3);
  const dy = clamp((event.clientY - centerY) / 40, -2, 2);
  app.style.setProperty('--eye-x', `${dx}px`);
  app.style.setProperty('--eye-y', `${dy}px`);
}

async function beginWindowDrag(event) {
  if (event.button !== 0 || event.target.closest('input, textarea, button:not(.pet), .panel')) {
    return;
  }

  const bounds = await bridge.getWindowBounds();
  const startScreenX = Number(event.screenX);
  const startScreenY = Number(event.screenY);
  if (
    !bounds ||
    !Number.isFinite(startScreenX) ||
    !Number.isFinite(startScreenY) ||
    !Number.isFinite(Number(bounds.x)) ||
    !Number.isFinite(Number(bounds.y))
  ) {
    return;
  }

  state.drag = {
    pointerId: event.pointerId,
    startScreenX,
    startScreenY,
    startX: Number(bounds.x),
    startY: Number(bounds.y),
    moved: false,
    sourceIsPet: event.currentTarget === petButton || event.target.closest('.pet') !== null,
    pending: null,
    frame: 0
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function updateWindowDrag(event) {
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const screenX = Number(event.screenX);
  const screenY = Number(event.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

  const deltaX = screenX - drag.startScreenX;
  const deltaY = screenY - drag.startScreenY;
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
  if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;

  drag.moved = true;
  state.suppressPetClick = drag.sourceIsPet;
  app.classList.add('is-dragging');
  event.preventDefault();

  drag.pending = {
    x: drag.startX + deltaX,
    y: drag.startY + deltaY
  };
  if (!Number.isFinite(drag.pending.x) || !Number.isFinite(drag.pending.y)) return;

  if (drag.frame) return;
  drag.frame = requestAnimationFrame(async () => {
    const pending = drag.pending;
    drag.frame = 0;
    if (pending) {
      await bridge.moveWindow(pending).catch(() => null);
    }
  });
}

function endWindowDrag(event) {
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  if (drag.frame) {
    cancelAnimationFrame(drag.frame);
    if (drag.pending) {
      bridge.moveWindow(drag.pending).catch(() => null);
    }
  }

  if (drag.moved && drag.sourceIsPet) {
    state.suppressPetClick = true;
    clearTimeout(state.clickSuppressTimer);
    state.clickSuppressTimer = window.setTimeout(() => {
      state.suppressPetClick = false;
    }, 180);
  }
  state.drag = null;
  app.classList.remove('is-dragging');
}

async function sendChat(event) {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  addMessage('user', text);
  const typingId = addMessage('assistant', '皙皙想一想...');
  stopSpeaking();
  setMood('thinking');

  try {
    const result = await bridge.chat({
      messages: state.messages.slice(-16),
      persona: state.persona
    });
    replaceMessage(typingId, result.text || '我在，但是刚刚没有组织好语言。');
    updateStatusDetail(result.source === 'model' ? '模型陪伴' : '本地陪伴');
    setMood(result.source === 'model' ? 'calm' : 'happy');
    speak(firstSentence(result.text || '我在。'));
  } catch (error) {
    replaceMessage(typingId, '刚刚连接不太顺。我先留在这里，等你下一句。');
    setMood('tired');
    speak('连接不太顺，我先陪着。');
  }
}

function addMessage(role, content) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  state.messages.push({ id, role, content });
  state.messages = state.messages.slice(-60);
  saveJson('xixi:messages', state.messages);
  renderMessages();
  return id;
}

function replaceMessage(id, content) {
  const item = state.messages.find((message) => message.id === id);
  if (item) item.content = content;
  saveJson('xixi:messages', state.messages);
  renderMessages();
}

function savePersona(event) {
  event.preventDefault();
  const text = personaInput.value.trim();
  if (text.length < 8) {
    say('角色设定再写具体一点点。');
    return;
  }
  state.persona = text.slice(0, 900);
  personaInput.value = state.persona;
  saveJson('xixi:persona', state.persona);
  updateStatusDetail('设定已保存');
  say('皙皙记住新的角色设定了。');
}

function renderMessages() {
  messagesEl.replaceChildren();
  state.messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
    item.textContent = message.content;
    messagesEl.append(item);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function addReminder(event) {
  event.preventDefault();
  const message = reminderText.value.trim();
  const timestamp = new Date(reminderTime.value).getTime();

  if (!message || !Number.isFinite(timestamp)) {
    say('提醒需要内容和时间。');
    return;
  }

  const reminder = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    message,
    timestamp,
    done: false
  };

  state.reminders.push(reminder);
  state.reminders.sort((a, b) => a.timestamp - b.timestamp);
  saveJson('xixi:reminders', state.reminders);
  await bridge.scheduleReminder(reminder);
  reminderText.value = '';
  setReminderDefaultTime();
  renderReminders();
  setMood('happy');
  say(`记住了：${message}`);
}

function renderReminders() {
  reminderList.replaceChildren();
  const active = state.reminders.filter((reminder) => !reminder.done).slice(0, 12);

  if (active.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'reminder-item';
    empty.innerHTML = '<div><strong>暂无提醒</strong><span>加一个小事给我守着。</span></div>';
    reminderList.append(empty);
    return;
  }

  active.forEach((reminder) => {
    const item = document.createElement('div');
    item.className = 'reminder-item';

    const text = document.createElement('div');
    const strong = document.createElement('strong');
    const time = document.createElement('span');
    strong.textContent = reminder.message;
    time.textContent = formatDate(reminder.timestamp);
    text.append(strong, time);

    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.title = '删除';
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      await bridge.cancelReminder(reminder.id);
      state.reminders = state.reminders.filter((item) => item.id !== reminder.id);
      saveJson('xixi:reminders', state.reminders);
      renderReminders();
    });

    item.append(text, remove);
    reminderList.append(item);
  });
}

function scheduleFutureReminders() {
  state.reminders
    .filter((reminder) => !reminder.done && reminder.timestamp > Date.now())
    .forEach((reminder) => bridge.scheduleReminder(reminder));
  state.reminders
    .filter((reminder) => !reminder.done && reminder.timestamp <= Date.now())
    .forEach((reminder) => {
      reminder.done = true;
    });
  saveJson('xixi:reminders', state.reminders);
  renderReminders();
}

function markReminderDone(id) {
  const reminder = state.reminders.find((item) => item.id === id);
  if (reminder) reminder.done = true;
  saveJson('xixi:reminders', state.reminders);
  renderReminders();
}

function setReminderDefaultTime() {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  date.setSeconds(0, 0);
  reminderTime.value = toDatetimeLocal(date);
  reminderTime.min = toDatetimeLocal(new Date());
}

async function toggleCamera() {
  if (state.cameraStream) {
    stopCamera();
    return;
  }

  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 320 },
        height: { ideal: 240 },
        facingMode: 'user'
      },
      audio: false
    });
    cameraPreview.srcObject = state.cameraStream;
    await cameraPreview.play();
    cameraToggle.textContent = '关闭';
    emotionStatus.textContent = state.config?.hasApiKey ? '模型识别中' : '本地估计中';
    updateStatusDetail('观察中');
    setMood('focused');
    say('我会轻轻观察一下。');
    runEmotionScan(true);
    state.emotionTimer = setInterval(() => runEmotionScan(false), 30_000);
  } catch (error) {
    emotionStatus.textContent = '无法开启';
    setMood('tired');
    say('摄像头没有打开成功。');
  }
}

function stopCamera() {
  clearInterval(state.emotionTimer);
  state.emotionTimer = null;
  state.previousFrame = null;
  state.cameraStream.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  cameraPreview.srcObject = null;
  cameraToggle.textContent = '开启';
  emotionStatus.textContent = '未开启';
  updateStatusDetail('陪伴中');
  setMood('calm');
  say('摄像头关掉了，我继续在旁边。');
}

async function runEmotionScan(manual) {
  if (!state.cameraStream || cameraPreview.readyState < 2) {
    if (manual) say('先开启摄像头。');
    return;
  }

  emotionStatus.textContent = '识别中';
  try {
    const capture = await captureFrame();
    const result = await bridge.detectEmotion(capture);
    applyEmotion(result);
  } catch (error) {
    emotionStatus.textContent = '识别失败';
    emotionLabel.textContent = '没有读到状态';
    emotionReason.textContent = '这次画面没有处理成功，可以稍后再试。';
    updateStatusDetail('识别失败');
    setMood('thinking');
  }
}

async function captureFrame() {
  const width = 160;
  const height = 120;
  cameraCanvas.width = width;
  cameraCanvas.height = height;
  const context = cameraCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(cameraPreview, 0, 0, width, height);
  const frame = context.getImageData(0, 0, width, height);
  const localSignals = await computeSignals(frame);

  return {
    imageData: cameraCanvas.toDataURL('image/jpeg', 0.72),
    localSignals
  };
}

async function computeSignals(frame) {
  const data = frame.data;
  let brightness = 0;
  let motion = 0;
  let samples = 0;

  for (let index = 0; index < data.length; index += 32) {
    const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
    brightness += value;
    if (state.previousFrame) {
      const previous = (state.previousFrame[index] + state.previousFrame[index + 1] + state.previousFrame[index + 2]) / 3;
      motion += Math.abs(value - previous);
    }
    samples += 1;
  }

  state.previousFrame = new Uint8ClampedArray(data);

  const signals = {
    brightness: brightness / samples / 255,
    motion: state.previousFrame ? motion / samples / 255 : 0
  };

  if ('FaceDetector' in window) {
    try {
      state.faceDetector ||= new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await state.faceDetector.detect(cameraPreview);
      signals.faceCount = faces.length;
    } catch {
      signals.faceCount = Number.NaN;
    }
  }

  return signals;
}

function applyEmotion(result) {
  const mood = emotionMoodMap[result.emotion] || 'thinking';
  const confidence = Math.round((Number(result.confidence) || 0) * 100);
  const label = moodText[result.emotion] || '观察中';
  emotionStatus.textContent = result.source === 'model' ? '模型结果' : '本地结果';
  emotionLabel.textContent = `${label} · ${confidence}%`;
  emotionReason.textContent = `${result.reason || ''} ${result.suggestion || ''}`.trim();
  setMood(mood);
  updateStatusDetail(`${result.source === 'model' ? '情绪' : '本地'} ${confidence}%`);
  if (!state.quiet) {
    say(result.suggestion || '我会先陪着你。');
  }
}

function setMood(mood) {
  app.dataset.mood = mood;
  moodLabel.textContent = moodText[mood] || moodText.calm;
}

function updateStatusDetail(text) {
  modelStatus.textContent = text;
}

function say(text) {
  bubble.textContent = text;
  bubble.classList.remove('is-hidden');
  scheduleBubbleHide();
}

function speak(text) {
  say(text);
  app.classList.add('is-speaking');
  clearTimeout(state.speakingTimer);
  const duration = clamp(String(text || '').length * 90, 900, 3600);
  state.speakingTimer = window.setTimeout(() => {
    stopSpeaking();
  }, duration);
}

function stopSpeaking() {
  clearTimeout(state.speakingTimer);
  app.classList.remove('is-speaking');
}

function scheduleBubbleHide() {
  clearTimeout(state.bubbleTimer);
  state.bubbleTimer = window.setTimeout(() => {
    bubble.classList.add('is-hidden');
  }, 20_000);
}

function showWindowControls(autoHide = true) {
  app.classList.add('controls-visible');
  clearTimeout(state.controlsTimer);
  if (autoHide) {
    scheduleWindowControlsHide(4_000);
  }
}

function scheduleWindowControlsHide(delay) {
  clearTimeout(state.controlsTimer);
  state.controlsTimer = window.setTimeout(() => {
    app.classList.remove('controls-visible');
  }, delay);
}

function applyCompact(enabled) {
  state.compact = Boolean(enabled);
  saveJson('xixi:compact', state.compact);
  app.classList.toggle('is-compact', state.compact);
  compactBtn.title = state.compact ? '展开' : '收起';
  compactBtn.textContent = state.compact ? '↧' : '↕';
  bridge.setCompact(state.compact);
}

async function applyAlwaysTop(enabled) {
  state.alwaysTop = Boolean(enabled);
  saveJson('xixi:alwaysTop', state.alwaysTop);
  pinBtn.classList.toggle('is-active', state.alwaysTop);
  alwaysTopToggle.checked = state.alwaysTop;
  await bridge.setAlwaysOnTop(state.alwaysTop);
}

function firstSentence(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.split(/[。！？.!?]/)[0].slice(0, 42) || '我在。';
}

function toDatetimeLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function migrateDisplayName(message) {
  if (!message || typeof message.content !== 'string') return message;
  return {
    ...message,
    content: message.content.replaceAll('希希', '皙皙')
  };
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function hasStoredValue(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createBrowserFallback() {
  return {
    getConfig: async () => ({
      hasApiKey: false,
      model: 'browser-preview',
      visionModel: 'browser-preview',
      defaultPersona: DEFAULT_PERSONA
    }),
    setAlwaysOnTop: async () => true,
    setCompact: async () => true,
    hideWindow: async () => true,
    getWindowBounds: async () => ({ x: window.screenX, y: window.screenY }),
    moveWindow: async () => true,
    chat: async ({ messages }) => ({
      text: `我收到了：${messages.at(-1)?.content || '你好'}。Electron 启动后我就能接后端模型啦。`,
      source: 'local'
    }),
    detectEmotion: async ({ localSignals }) => ({
      emotion: localSignals?.brightness < 0.2 ? 'tired' : 'calm',
      confidence: 0.24,
      reason: '浏览器预览模式只做本地占位估计。',
      suggestion: '启动桌面版后可以接视觉模型。',
      source: 'local'
    }),
    scheduleReminder: async () => ({ ok: true }),
    cancelReminder: async () => ({ ok: true }),
    showNotification: async () => true,
    onReminderDue: () => () => {}
  };
}
