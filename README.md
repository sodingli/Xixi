# 皙皙桌面悬浮陪伴玩偶

皙皙是一个 Electron 桌面悬浮窗玩偶。它支持鼠标互动、聊天陪伴、提醒、摄像头情绪识别，以及 OpenAI 兼容的大模型后端。

## 启动

```bash
pnpm install
pnpm dev
```

如果在非交互环境里遇到 pnpm 的依赖检查提示，也可以直接运行：

```bash
./node_modules/.bin/electron .
```

没有配置模型密钥时，皙皙会使用本地占位陪伴回复和轻量画面估计，方便先跑起来。

## 接入大模型

支持 OpenAI 兼容的 `/chat/completions` 接口：

项目会自动读取根目录的 `.env.local`。当前已配置为阿里云百炼 compatible-mode，并使用全模态模型 `qwen3-omni-flash`。

```bash
export OPENAI_API_KEY="你的密钥"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4.1-mini"
export OPENAI_VISION_MODEL="gpt-4.1-mini"
pnpm dev
```

也可以直接编辑 `.env.local`：

```bash
OPENAI_BASE_URL="https://..."
OPENAI_API_KEY="你的密钥"
OPENAI_MODEL="qwen3-omni-flash"
OPENAI_VISION_MODEL="qwen3-omni-flash"
```

如果使用其他兼容服务，把 `OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_VISION_MODEL` 换成对应配置即可。也可以设置 `XIXI_PERSONA` 自定义皙皙的人设。

## 功能

- 透明置顶桌面悬浮窗，支持收起、隐藏和保持置顶。
- 点按玩偶会触发表情、气泡和眼睛跟随鼠标。
- 聊天页会把最近对话发给模型，模型不可用时自动退回本地陪伴模式。
- 设置页可以编辑皙皙的角色设定，聊天时会作为 system prompt 带入大模型。
- 提醒页可以添加定时提醒，到点弹出系统通知并让皙皙提示。
- 情绪页需要手动开启摄像头。配置视觉模型后会发送当前截图做情绪推测；未配置时只用本地亮度和画面变化做占位估计。

## 隐私提示

摄像头默认关闭。只有在情绪页点击开启后，皙皙才会读取画面；配置视觉模型时，识别会把当前截图发往你配置的模型服务。
