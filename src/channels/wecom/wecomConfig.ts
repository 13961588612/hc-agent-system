/**
 * 企业微信渠道：HTTP 回调与智能机器人长连接（WebSocket）。
 * 详见 `docs/channel-wecom.md` 与 `config/channels.example.yaml`。
 */
import type { ChannelsConfig } from "../../config/channelsConfig.js";
import  type { EnvConfig } from "../../config/envConfig.ts";

/** 接入方式：长连接（默认）| HTTP 回调 */
export type WeComTransportMode = "long_connection" | "http_callback";

export interface WeComChannelConfig {
  /** 是否启用 HTTP 回调服务 */
  enabled: boolean;
  transport: WeComTransportMode;
  corpId: string;
  corpSecret: string;
  http: WeComHttpConfig;
  longConnection: WeComLongConnectionConfig;
}

/** 智能机器人长连接（`@wecom/aibot-node-sdk`） */
export interface WeComLongConnectionConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  /** 默认 `wss://openws.work.weixin.qq.com`，一般无需修改 */
  wsUrl?: string;
}

export interface WeComHttpConfig {
  enabled: boolean;
  callbackPath: string;
  agentId: string;
  webhookKey: string;
  token: string;
  encodingAESKey: string;
  plaintextMode: boolean;
  port: number;
}

/** HTTP 回调所需配置（验签 + 加解密）；字段不全则返回 `null` */
export function loadWeComHttpConfig(channels: ChannelsConfig): WeComHttpConfig | null {
  
  const enabled = channels?.wecom?.http?.enabled ?? false;
  const callbackPath = channels?.wecom?.http?.callbackPath ?? "/wecom/callback";
  const agentId = channels?.wecom?.http?.agentId ?? "";
  const webhookKey = channels?.wecom?.http?.webhookKey ?? "";
  const token = channels?.wecom?.http?.token ?? "";
  const encodingAESKey = channels?.wecom?.http?.encodingAESKey ?? "";
  const plaintextMode = channels?.wecom?.http?.plaintextMode ?? false;
  const port = channels?.wecom?.http?.port ?? 3000;
  return {
    enabled,
    callbackPath,
    agentId,
    webhookKey,
    token,
    encodingAESKey,
    plaintextMode,
    port
  } as WeComHttpConfig;
}

/** 长连接所需 `WECOM_BOT_ID` / `WECOM_BOT_SECRET`；不全则返回 `null` */
export function loadWeComLongConfig(channels: ChannelsConfig): WeComLongConnectionConfig | null {
  const botId = channels?.wecom?.longConnection?.botId ?? "";
  const secret = channels?.wecom?.longConnection?.botSecret ?? "";
  
  const enabled = channels?.wecom?.longConnection?.enabled ?? false;
  const wsUrl = channels?.wecom?.longConnection?.wsUrl ?? "wss://openws.work.weixin.qq.com";

  if (!botId || !secret) {
    return null;
  }
  
  return {
    enabled,
    botId,
    secret,
    wsUrl: wsUrl || undefined,  
  } as WeComLongConnectionConfig;
}

export function loadWeComConfig(  channels: ChannelsConfig): WeComChannelConfig | null {
  const transport = channels?.wecom?.transport ?? "long_connection";
  const http = loadWeComHttpConfig( channels);
  const longConnection = loadWeComLongConfig(channels);
  const enabled = channels?.wecom?.enabled ?? false;
  const corpId = channels?.wecom?.corpId ?? "";
  const corpSecret = channels?.wecom?.corpSecret ?? "";
  
  return {
    enabled,
    transport,
    corpId,
    corpSecret,
    http: http as WeComHttpConfig,
    longConnection: longConnection as WeComLongConnectionConfig
  } as WeComChannelConfig;
}