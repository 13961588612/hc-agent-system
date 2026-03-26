# 企业微信渠道（HTTP 回调）

本仓库通过 **`CHANNEL_MODE=wecom-http`** 启动常驻 HTTP 服务，接收企业微信「接收消息」回调：URL 验证（GET）、消息解密（POST），再调用编排图；若配置了应用凭证，则通过 **主动发消息** API 将文本回复给用户。

## 前置条件

- 企业微信管理后台为应用配置 **接收消息** URL，与下文 `WECOM_CALLBACK_PATH` 一致（经 HTTPS 反代到本服务端口）。
- 在后台填写 **Token**、**EncodingAESKey**，与进程环境变量一致。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `CHANNEL_MODE` | 启动企微模式时 | 设为 `wecom-http`（或设 `WECOM_HTTP_ENABLED=1`） |
| `WECOM_TOKEN` | 是 | 与后台「Token」一致，用于验签 |
| `WECOM_ENCODING_AES_KEY` | 是 | 43 字符，与后台「EncodingAESKey」一致 |
| `WECOM_CORP_ID` | 是 | 企业 ID |
| `WECOM_HTTP_PORT` | 否 | 监听端口，默认 `3000` |
| `WECOM_CALLBACK_PATH` | 否 | 回调路径，默认 `/wecom/callback` |
| `WECOM_CORP_SECRET` 或 `WECOM_SECRET` | 发消息时 | 应用 Secret，用于 `gettoken` 与 `message/send` |
| `WECOM_AGENT_ID` | 发消息时 | 应用 AgentId |
| `WECOM_PLAINTEXT_MODE` | 否 | 设为 `1` 时 POST 可传明文 JSON（仅本地联调，**勿用于生产**） |

企微会将 **`msg_signature`、`timestamp`、`nonce` 放在回调 URL 的 query** 上；POST 体为加密 XML（含 `<Encrypt>`）。实现见 `src/channels/wecom/wecomHttpServer.ts`。

## 本地运行

1. 复制 `config/channels.example.yaml` 为 `config/channels.yaml`（可选，当前仍以环境变量为主）。
2. 在 `.env` 或 `.env.local` 中填写上述变量。
3. 执行：

```bash
npm run dev:wecom
```

或手动设置 `CHANNEL_MODE=wecom-http` 后 `npm run dev`。

## 会话与 thread_id

同一企微用户的多轮对话使用固定 **`thread_id = ${userId}:wecom`**，与 LangGraph checkpoint 对齐。

## 相关代码

- `src/channels/wecom/wecomEnv.ts`：配置加载
- `src/channels/wecom/wxBizMsgCrypt.ts`：验签与加解密
- `src/channels/wecom/wecomHttpServer.ts`：HTTP 服务入口
- `src/index.ts`：按 `CHANNEL_MODE` 分支启动
