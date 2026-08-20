# 皙皙桌面悬浮陪伴玩偶

皙皙是一个 Electron 桌面悬浮窗玩偶。它支持鼠标互动、聊天陪伴、提醒、摄像头情绪识别，以及 OpenAI 兼容的大模型后端。

## 启动

```bash
corepack pnpm install
corepack pnpm dev
```

如果在非交互环境里遇到 pnpm 的依赖检查提示，也可以直接运行：

```bash
./node_modules/.bin/electron .
```

没有配置模型密钥时，皙皙会使用本地占位陪伴回复和轻量画面估计，方便先跑起来。

## 打包安装

生成 macOS 安装包：

```bash
corepack pnpm run dist
```

产物会输出到 `release/`，通常包含：

- `皙皙-0.1.0-arm64.dmg` 或 `皙皙-0.1.0-x64.dmg`
- `皙皙-0.1.0-arm64.zip` 或 `皙皙-0.1.0-x64.zip`

打开 `.dmg` 后把 `皙皙.app` 拖到“应用程序”即可。当前安装包未做 Apple 开发者签名和公证，如果 macOS 提示无法验证开发者，可以在“访达”里右键 App 选择“打开”。

## 接入大模型

支持 OpenAI 兼容的 `/chat/completions` 接口：

开发模式会读取项目根目录的 `.env.local`。安装后的 App 会读取：

```text
~/Library/Application Support/皙皙/.env.local
```

```bash
export OPENAI_API_KEY="你的密钥"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4.1-mini"
export OPENAI_VISION_MODEL="gpt-4.1-mini"
corepack pnpm dev
```

也可以参考 `.env.example` 创建 `.env.local`：

```bash
OPENAI_BASE_URL="https://..."
OPENAI_API_KEY="你的密钥"
OPENAI_MODEL="qwen3-omni-flash"
OPENAI_VISION_MODEL="qwen3-omni-flash"
```

安装版可以这样创建配置文件：

```bash
mkdir -p "$HOME/Library/Application Support/皙皙"
cp .env.example "$HOME/Library/Application Support/皙皙/.env.local"
open -e "$HOME/Library/Application Support/皙皙/.env.local"
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
