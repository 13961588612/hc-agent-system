# 企业微信渠道（长连接 + HTTP 回调）

企业微信支持两种接入方式，本仓库均已实现：

| 方式 | 说明 | 默认 |
|------|------|------|
| **智能机器人长连接** | `@wecom/aibot-node-sdk` WebSocket（`wss://openws.work.weixin.qq.com`），无需对外暴露 HTTP 回调 URL | **是** |
| **HTTP 回调** | 接收消息 URL + Token + EncodingAESKey，见 `wecomHttpServer.ts` + `wxBizMsgCrypt.ts` | 显式选择时使用 |

接入方式由 **`CHANNEL_MODE`**、**`WECOM_TRANSPORT`**、`config/channels.yaml` 中 `wecom.transport` 共同决定（详见下文「如何选择 transport」）。

## 入口与环境变量（`CHANNEL_MODE`）

| 值 | 含义 |
|----|------|
| `wecom` | 企业微信渠道；具体长连接或 HTTP 由 **transport 解析**决定，**未指定时默认为长连接** |
| `wecom-long` | 固定使用长连接（忽略 YAML/env 中的 `http_callback`） |
| `wecom-http` | 固定使用 HTTP 回调（兼容旧用法） |
| `cli` | 本地 CLI 演示，不走企微 |

## 如何选择 transport（优先级从高到低）

1. `CHANNEL_MODE=wecom-http` → 固定 **HTTP 回调**
2. `CHANNEL_MODE=wecom-long` → 固定 **长连接**
3. 环境变量 **`WECOM_TRANSPORT`**：`http_callback` / `http` / `callback` → HTTP；`long_connection` / `long` / `ws` → 长连接
4. **`config/channels.yaml`**（或 `CHANNELS_CONFIG` 指向的文件）中 `wecom.transport`：`http_callback` | `long_connection`
5. 否则 → **长连接**（`long_connection`）

可选：通过环境变量 **`CHANNELS_CONFIG`** 指定渠道 YAML 路径（默认 `<cwd>/config/channels.yaml`）。

## 长连接（默认）所需变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `WECOM_BOT_ID` | 是 | 智能机器人 ID |
| `WECOM_BOT_SECRET` | 是 | 智能机器人 Secret |
| `WECOM_WS_URL` | 否 | 自定义 WebSocket 地址，默认 `wss://openws.work.weixin.qq.com` |

对应 `src/config/env.ts` 中 `wecomBotId` / `wecomBotSecret`（供编排与其它逻辑读取）。

## HTTP 回调所需变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `WECOM_TOKEN` | 是 | 与后台「Token」一致，用于验签 |
| `WECOM_ENCODING_AES_KEY` | 是 | 43 字符，与后台「EncodingAESKey」一致 |
| `WECOM_CORP_ID` | 是 | 企业 ID |
| `WECOM_HTTP_PORT` | 否 | 监听端口，默认 `3000` |
| `WECOM_CALLBACK_PATH` | 否 | 回调路径，默认 `/wecom/callback` |
| `WECOM_WEBHOOK_KEY` | 否 | 群机器人 Webhook 的 `key`；配置后发回复优先走 Webhook |
| `WECOM_CORP_SECRET` 或 `WECOM_SECRET` | 应用私聊时 | 应用 Secret，用于 `gettoken` 与 `message/send` |
| `WECOM_AGENT_ID` | 应用私聊时 | 应用 AgentId |
| `WECOM_PLAINTEXT_MODE` | 否 | `1` 时 POST 可传明文 JSON（仅联调，**勿用于生产**） |

## 本地运行

**长连接（默认）：**

```bash
npm run dev:wecom
```

等价于 `CHANNEL_MODE=wecom`（配合 `.env` 中的 `WECOM_BOT_ID` / `WECOM_BOT_SECRET`）。

**HTTP 回调：**

```bash
npm run dev:wecom-http
```

或 `CHANNEL_MODE=wecom` 且 `WECOM_TRANSPORT=http_callback`（并配置 Token / AESKey / CorpId）。

## 会话与 thread_id

同一企微用户的多轮对话使用固定 **`thread_id = ${userId}:wecom`**，与 LangGraph checkpoint 对齐（HTTP 与长连接一致）。

## 相关代码

- `src/config/channelsConfig.ts`：读取 `channels.yaml`
- `src/channels/wecom/wecomEnv.ts`：`resolveWeComTransport`、`loadWeComHttpConfigFromEnv`、`loadWeComLongConfigFromEnv`
- `src/channels/wecom/wecomLongConnection.ts`：长连接入口（`@wecom/aibot-node-sdk`）
- `src/channels/wecom/wecomHttpServer.ts`：HTTP 回调
- `src/channels/wecom/wxBizMsgCrypt.ts`：验签与加解密（仅 HTTP）
- `src/channels/wecom/wecomSendMessage.ts`：HTTP 渠道下发（Webhook / `message/send`）
- `src/index.ts`：按 `CHANNEL_MODE` 与 transport 分支启动
