# 皙皙全双工语音陪伴设计

## 目标

为桌面悬浮玩偶“皙皙”增加持续倾听、自动轮次检测、实时语音回复和中途打断能力。用户点击一次“语音陪伴”后，皙皙持续工作，直到用户再次点击停止、关闭窗口或应用退出。

## 非目标

- 不开放常驻后台监听；麦克风只在用户主动开启语音陪伴后工作。
- 不把摄像头画面加入实时语音会话；现有情绪识别仍使用独立的摄像头开关。
- 不做唤醒词检测。应用启动后默认不监听麦克风。
- 不在渲染页面暴露 API Key。

## 用户体验

聊天输入框右侧增加麦克风按钮。

1. 用户点击麦克风按钮，获取麦克风权限并建立实时语音会话。
2. 连接完成后进入“聆听中”，用户可以直接说话，无需每句话按键。
3. 服务端检测到用户停止说话后自动生成文本和语音回复。
4. 皙皙播报时，用户再次说话会触发打断：立即停止本地播放，并取消服务端当前回复。
5. 用户再次点击麦克风按钮，关闭录音、播放和实时连接，回到普通文字聊天模式。

按钮和角色表情需要体现以下状态：

- `idle`：未开启。
- `connecting`：正在连接。
- `listening`：正在聆听。
- `thinking`：用户已说完，等待模型响应。
- `speaking`：正在播报。
- `error`：连接或模型调用失败。

语音状态优先于普通装饰动画，但不得改变用户设置的基础情绪状态。

## 架构

### 渲染进程

`src/app.js` 管理语音按钮、麦克风媒体流、`RTCPeerConnection`、远端音频播放、DataChannel 事件和聊天记录联动。语音回复的文字转写加入现有 `state.messages`，用户语音转写也在完成后加入。

### Electron 主进程

`electron/main.cjs` 负责：

- 解析实时模型名和实时 WebRTC 信令地址。
- 使用环境变量中的 API Key 向阿里云实时服务发起 SDP 交换。
- 向渲染进程返回 Answer SDP，不返回 API Key。
- 提供语音配置状态，便于页面区分“未配置”和“连接失败”。

### Preload

`electron/preload.cjs` 通过白名单 IPC 暴露：

- `getVoiceConfig()`：读取实时模型配置和可用状态。
- `exchangeVoiceSdp(offerSdp)`：提交 Offer SDP，返回 Answer SDP 或结构化错误。

## 实时服务配置

默认实时模型：

```text
qwen3.8-omni-flash-realtime
```

优先读取：

```text
OPENAI_REALTIME_MODEL
OPENAI_REALTIME_URL
```

如果没有 `OPENAI_REALTIME_URL`，则从 `OPENAI_BASE_URL` 的 origin 派生：

```text
https://<workspace-host>/api/v1/webrtc/realtime?model=<model>
```

API Key 继续从现有的 `OPENAI_API_KEY` 或 `XIXI_API_KEY` 读取。安装版仍从 `~/Library/Application Support/皙皙/.env.local` 加载。

## WebRTC 会话

1. 渲染进程请求 `getUserMedia({ audio: true })`。
2. 创建 `RTCPeerConnection`，设置空 ICE server 列表，并添加本地音频轨道。
3. 创建 DataChannel，用于发送 `session.update` 和接收服务端事件。
4. 生成 Offer 和本地描述。
5. 渲染进程把 Offer SDP 发送给主进程。
6. 主进程以 `application/sdp` 向实时信令地址 POST，并附带 Bearer Token。
7. 主进程把 Answer SDP 返回渲染进程。
8. 渲染进程设置远端描述，等待连接和 `session.created`。
9. 收到 `session.created` 后发送 `session.update`。

`session.update` 需要配置：

- `modalities: ["text", "audio"]`
- 中文音色 `Tina`
- `turn_detection` 使用 `semantic_vad`，静音结束约 800 毫秒
- 以用户当前角色设定作为 `instructions`
- 输入音频转写开启，以便用户语音内容进入聊天记录

实时提示词应在角色设定后追加口语约束：回复简短、先承接情绪、不要在无必要时长篇解释。

## 事件处理

必须处理以下服务端事件：

- `session.created`：发送会话配置。
- `session.updated`：进入聆听状态。
- `input_audio_buffer.speech_started`：更新为聆听/打断状态。
- `input_audio_buffer.speech_stopped`：更新为思考状态。
- `conversation.item.input_audio_transcription.completed`：把用户转写加入聊天。
- `response.created`：标记模型开始回复。
- `response.audio_transcript.delta`：累积皙皙回复文字。
- `response.audio_transcript.done`：把完整回复加入聊天。
- `response.done`：回到聆听状态。
- `error`：记录结构化错误并进入错误状态。

音频由 WebRTC 远端音轨直接播放，不处理 `response.audio.delta` 的 PCM 数据。

## 打断

检测到 `input_audio_buffer.speech_started` 且当前处于播报或思考状态时：

1. 立即把远端音频元素静音或暂停。
2. 通过 DataChannel 发送 `response.cancel`。
3. 清空未完成的 assistant 流式缓冲，避免把被打断的半句话写入聊天。
4. 恢复 `listening` 状态。

本地播放和远端状态要同时处理，不能只停 UI。

## 聊天记录

- 用户语音转写以 `user` 消息写入现有聊天。
- 皙皙语音转写以 `assistant` 消息写入现有聊天。
- 相同 `item_id` 或响应 ID 只写入一次。
- 被打断且未完成的 assistant 回复不写入。
- 语音聊天记录继续受现有 60 条上限约束。

## 错误处理和重连

- 浏览器不支持 WebRTC 或麦克风 API：显示“当前环境不支持语音陪伴”。
- 用户拒绝麦克风权限：显示“需要麦克风权限”，不自动重复请求。
- 未配置 API Key：不建立媒体连接，提示配置方法。
- SDP 交换失败：显示服务端错误摘要，清理媒体轨道。
- WebRTC 连接失败或断开：结束当前会话并清理资源；允许用户再次点击重连，不进行无上限自动重试。
- DataChannel 错误：结束会话，避免出现“按钮显示开启但实际无响应”。
- 应用隐藏或窗口关闭：停止麦克风、远端音频和连接。

## 隐私

- 麦克风默认关闭。
- 开启后按钮和界面必须持续可见地表示正在收听。
- 不把音频、转写或 API Key 写入本地日志。
- 音频通过 WebRTC 发送到用户配置的阿里云实时模型服务。
- API Key 只存在于主进程环境变量和主进程发起的 HTTP 请求中。

## 测试

自动测试覆盖纯逻辑部分：

- 从兼容接口 URL 派生实时 WebRTC URL。
- 实时配置缺少 API Key 时返回不可用状态。
- 实时提示词包含角色设定和简短口语约束。
- 重复语音事件不会重复写入聊天。
- 被打断的半回复不会写入最终聊天。

手工验证覆盖：

- 第一次点击开启麦克风，第二次点击关闭。
- 连续说多句话无需重复点击。
- 静止时不产生回复，正常说完后自动回复。
- 皙皙播报时插话可以停止本地音频。
- 拒绝麦克风权限后按钮恢复关闭状态。
- 无 API Key 和不支持实时模型的错误提示准确。
- 打包后的 `.app` 可以从用户配置目录读取实时模型配置。

## 验收标准

- 用户只操作一次即可持续进行语音对话。
- 自动检测说话起止，不需要文字发送或重复点麦克风。
- 皙皙能用语音回复，并同步显示文字转写。
- 用户能在皙皙说话时打断。
- 再次点击按钮可以彻底关闭麦克风和连接。
- API Key 不出现在渲染进程、日志、聊天记录或安装包中。
