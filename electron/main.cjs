const { app, BrowserWindow, Notification, ipcMain, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MAX_TIMEOUT = 2_147_483_647;
const reminderTimers = new Map();

let mainWindow;

loadLocalEnv();

function getBaseUrl() {
  return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || process.env.XIXI_API_KEY || '';
}

function getChatModel() {
  return process.env.OPENAI_MODEL || process.env.XIXI_MODEL || 'gpt-4.1-mini';
}

function getVisionModel() {
  return process.env.OPENAI_VISION_MODEL || process.env.XIXI_VISION_MODEL || 'gpt-4.1-mini';
}

function getDefaultPersona() {
  return (
    process.env.XIXI_PERSONA ||
    '你叫皙皙，是一个桌面悬浮陪伴玩偶。你说中文，语气温柔、轻松、有一点俏皮，但不要油腻。你的目标是陪伴、倾听、提醒和帮助用户整理当下的小事。回答要短一些，优先给情绪承接和一个可执行的小建议。不要声称自己能替代医生或专业咨询。'
  );
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || process.env[key]) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 360;
  const height = 560;

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 300,
    minHeight: 420,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    fullscreenable: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: false,
    title: '皙皙',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env.ELECTRON_DEBUG) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('local.xixi.companion');
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }
  mainWindow?.show();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:get-config', () => ({
  hasApiKey: Boolean(getApiKey()),
  baseUrl: getBaseUrl(),
  model: getChatModel(),
  visionModel: getVisionModel(),
  defaultPersona: getDefaultPersona()
}));

ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
  const isEnabled = Boolean(enabled);
  mainWindow?.setAlwaysOnTop(isEnabled, 'floating');
  return isEnabled;
});

ipcMain.handle('window:set-compact', (_event, enabled) => {
  if (!mainWindow) return false;

  const compact = Boolean(enabled);
  mainWindow.setResizable(true);
  mainWindow.setSize(compact ? 292 : 360, compact ? 360 : 560, true);
  mainWindow.setResizable(false);
  return compact;
});

ipcMain.handle('window:hide', () => {
  mainWindow?.hide();
  return true;
});

ipcMain.handle('window:get-bounds', () => mainWindow?.getBounds() || null);

ipcMain.handle('window:move-to', (_event, position) => {
  if (!mainWindow) return null;

  const bounds = mainWindow.getBounds();
  const x = toSafeInteger(position?.x, bounds.x);
  const y = toSafeInteger(position?.y, bounds.y);
  const next = constrainWindowPosition(x, y, bounds);

  try {
    mainWindow.setPosition(next.x, next.y, false);
  } catch {
    return mainWindow.getBounds();
  }
  return mainWindow.getBounds();
});

function toSafeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.round(number);
  if (!Number.isSafeInteger(rounded)) return fallback;
  return Math.max(-100_000, Math.min(100_000, rounded));
}

function constrainWindowPosition(x, y, windowBounds) {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return { x, y };

  const area = displays.reduce(
    (acc, display) => {
      const { workArea } = display;
      return {
        left: Math.min(acc.left, workArea.x),
        top: Math.min(acc.top, workArea.y),
        right: Math.max(acc.right, workArea.x + workArea.width),
        bottom: Math.max(acc.bottom, workArea.y + workArea.height)
      };
    },
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  );

  const maxX = Math.max(area.left, area.right - windowBounds.width);
  const maxY = Math.max(area.top, area.bottom - windowBounds.height);

  return {
    x: Math.max(area.left, Math.min(maxX, x)),
    y: Math.max(area.top, Math.min(maxY, y))
  };
}

ipcMain.handle('assistant:chat', async (_event, payload) => {
  try {
    if (!getApiKey()) {
      return {
        text: localCompanionReply(payload?.messages || []),
        source: 'local'
      };
    }

    const text = await callChatCompletion({
      model: getChatModel(),
      messages: buildCompanionMessages(payload?.messages || [], payload?.persona)
    });

    return { text, source: 'model' };
  } catch (error) {
    return {
      text: `${localCompanionReply(payload?.messages || [])}\n\n模型暂时没接上，我先用本地陪伴模式陪你。`,
      source: 'fallback',
      error: error.message
    };
  }
});

ipcMain.handle('emotion:detect', async (_event, payload) => {
  try {
    if (!getApiKey() || !payload?.imageData) {
      return localEmotionEstimate(payload?.localSignals);
    }

    const text = await callChatCompletion({
      model: getVisionModel(),
      messages: [
        {
          role: 'system',
          content:
            '你是桌面陪伴玩偶的情绪观察模块。根据摄像头单帧画面做温和、非诊断式的情绪推测。只返回 JSON，不要返回 Markdown。JSON 字段：emotion、confidence、reason、suggestion。emotion 用 happy/calm/sad/tired/stressed/surprised/focused/neutral/unknown 之一。confidence 为 0 到 1。'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                '请判断画面中用户此刻可能的情绪。不要做身份识别，不要推断敏感属性，只做陪伴场景下的轻量情绪观察。'
            },
            {
              type: 'image_url',
              image_url: {
                url: payload.imageData,
                detail: 'low'
              }
            }
          ]
        }
      ],
      maxTokens: 220,
      temperature: 0.2
    });

    return normalizeEmotionResult(parseJsonObject(text));
  } catch (error) {
    return {
      ...localEmotionEstimate(payload?.localSignals),
      source: 'fallback',
      error: error.message
    };
  }
});

ipcMain.handle('reminder:schedule', (_event, reminder) => {
  if (!reminder?.id || !Number.isFinite(reminder.timestamp)) {
    return { ok: false, error: 'Invalid reminder payload.' };
  }

  cancelReminder(reminder.id);
  const delay = Math.max(0, reminder.timestamp - Date.now());
  const timer = createLongTimer(() => {
    showReminder(reminder);
    reminderTimers.delete(reminder.id);
  }, delay);

  reminderTimers.set(reminder.id, timer);
  return { ok: true, delay };
});

ipcMain.handle('reminder:cancel', (_event, id) => cancelReminder(id));

ipcMain.handle('notification:show', (_event, payload) => {
  showNotification(payload?.title || '皙皙', payload?.body || '');
  return true;
});

async function callChatCompletion({ model, messages, temperature = 0.72, maxTokens = 720 }) {
  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Model request failed: ${response.status} ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Model returned an empty response.');
  }
  return text;
}

function buildCompanionMessages(rawMessages, customPersona) {
  const history = Array.isArray(rawMessages) ? rawMessages : [];
  const persona = normalizePersona(customPersona) || getDefaultPersona();

  return [
    { role: 'system', content: persona },
    ...history.slice(-18).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '').slice(0, 3000)
    }))
  ];
}

function normalizePersona(value) {
  const text = String(value || '').trim();
  if (text.length < 8) return '';
  return text.slice(0, 2000);
}

function localCompanionReply(rawMessages) {
  const messages = Array.isArray(rawMessages) ? rawMessages : [];
  const last = String(messages.at(-1)?.content || '').toLowerCase();
  const has = (words) => words.some((word) => last.includes(word));

  if (has(['难过', '崩溃', '不开心', '焦虑', '烦', 'sad', 'anxious'])) {
    return '我在这儿。先把肩膀放松一下，慢慢呼一口气。你可以只说最卡住的那一小块，我陪你拆开。';
  }
  if (has(['累', '困', '疲惫', '熬夜', 'tired'])) {
    return '听起来电量有点低。先喝口水，给自己五分钟不用表现的空白时间，我会乖乖待在旁边。';
  }
  if (has(['提醒', '别忘', 'todo', '待办'])) {
    return '收到。你可以在提醒页把时间和内容丢给我，到点我会弹出来叫你。';
  }
  if (has(['开心', '高兴', '好耶', '完成', 'done', 'happy'])) {
    return '好耶，这一下很值得被看见。把这个小胜利记下来，等会儿状态掉了也能拿它当证据。';
  }
  if (has(['计划', '开始', '不知道怎么做', '拖延'])) {
    return '我们先不要把整座山搬起来。挑一个两分钟能开始的动作：打开文件、写标题、列三条都行。';
  }

  const replies = [
    '嗯，我听着。你可以继续说，也可以只让我在旁边陪你待一会儿。',
    '收到这一小段心情了。要不要把它变成一个很小的下一步？我可以陪你一起想。',
    '我在桌角待命。你说一句，我接一句；你安静，我也安静陪着。'
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

function normalizeEmotionResult(value) {
  const allowed = new Set([
    'happy',
    'calm',
    'sad',
    'tired',
    'stressed',
    'surprised',
    'focused',
    'neutral',
    'unknown'
  ]);
  const emotion = allowed.has(value?.emotion) ? value.emotion : 'unknown';
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence) || 0.35));

  return {
    emotion,
    confidence,
    reason: String(value?.reason || '画面信息有限，只能做轻量推测。').slice(0, 160),
    suggestion: String(value?.suggestion || '我会先保持轻声陪伴。').slice(0, 160),
    source: 'model'
  };
}

function localEmotionEstimate(signals = {}) {
  const brightness = Number(signals.brightness);
  const motion = Number(signals.motion);
  const faceCount = Number(signals.faceCount);

  if (Number.isFinite(faceCount) && faceCount === 0) {
    return {
      emotion: 'unknown',
      confidence: 0.22,
      reason: '暂时没有稳定看到脸部画面。',
      suggestion: '把摄像头调到更舒服的位置，或先关掉摄像头也没关系。',
      source: 'local'
    };
  }

  if (Number.isFinite(brightness) && brightness < 0.18) {
    return {
      emotion: 'tired',
      confidence: 0.28,
      reason: '本地模式只能看到画面较暗，无法真正判断表情。',
      suggestion: '也许可以把屏幕调亮一点，顺手伸个懒腰。',
      source: 'local'
    };
  }

  if (Number.isFinite(motion) && motion > 0.18) {
    return {
      emotion: 'focused',
      confidence: 0.3,
      reason: '本地模式检测到画面变化较多，像是在忙碌或调整姿势。',
      suggestion: '我先不打扰你，需要我时点我一下就好。',
      source: 'local'
    };
  }

  return {
    emotion: 'calm',
    confidence: 0.26,
    reason: '未配置视觉模型时，我只能基于亮度和画面变化做占位估计。',
    suggestion: '看起来可以慢慢来。我会保持在旁边陪着。',
    source: 'local'
  };
}

function createLongTimer(callback, delay) {
  let handle;
  const timer = {
    cancelled: false,
    cancel() {
      this.cancelled = true;
      clearTimeout(handle);
    }
  };

  const schedule = (remaining) => {
    handle = setTimeout(() => {
      if (timer.cancelled) return;
      if (remaining > MAX_TIMEOUT) {
        schedule(remaining - MAX_TIMEOUT);
        return;
      }
      callback();
    }, Math.min(remaining, MAX_TIMEOUT));
  };

  schedule(delay);
  return timer;
}

function cancelReminder(id) {
  const timer = reminderTimers.get(id);
  if (timer) {
    timer.cancel();
    reminderTimers.delete(id);
  }
  return { ok: true };
}

function showReminder(reminder) {
  const body = reminder.message || '你有一个提醒';
  showNotification('皙皙提醒', body);
  mainWindow?.webContents.send('reminder:due', reminder);
  if (mainWindow?.isVisible() === false) {
    mainWindow.showInactive();
  }
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}
