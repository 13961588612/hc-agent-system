/**
 * 企业微信智能机器人 / 应用回调相关环境变量。
 * 详见 `docs/channel-wecom.md` 与 `config/channels.example.yaml`。
 */
export interface WeComChannelConfig {
  /** 是否启用 HTTP 回调服务 */
  enabled: boolean;
  /** 监听端口 */
  port: number;
  /** 回调路径，需与企微后台填写一致 */
  callbackPath: string;
  /** 回调配置的 Token（验签） */
  token: string;
  /** EncodingAESKey（43 字符，消息加解密） */
  encodingAESKey: string;
  /** 企业 ID */
  corpId: string;
  /** 应用 AgentId（发消息等） */
  agentId?: string;
  /** 应用 Secret（gettoken、发消息） */
  corpSecret?: string;
  /**
   * 开发联调：为 `1` 时 POST 可接收明文 JSON，跳过加解密（勿用于生产）
   */
  plaintextMode: boolean;
}

export function loadWeComConfigFromEnv(): WeComChannelConfig | null {
  const enabled = process.env.WECOM_HTTP_ENABLED === "1" || process.env.CHANNEL_MODE === "wecom-http";
  if (!enabled) return null;

  const token = process.env.WECOM_TOKEN?.trim() ?? "";
  const encodingAESKey = process.env.WECOM_ENCODING_AES_KEY?.trim() ?? "";
  const corpId = process.env.WECOM_CORP_ID?.trim() ?? "";

  if (!token || !encodingAESKey || !corpId) {
    console.warn(
      "[WeCom] WECOM_HTTP_ENABLED=1 但缺少 WECOM_TOKEN / WECOM_ENCODING_AES_KEY / WECOM_CORP_ID"
    );
    return null;
  }

  return {
    enabled: true,
    port: Number(process.env.WECOM_HTTP_PORT ?? "3000") || 3000,
    callbackPath: process.env.WECOM_CALLBACK_PATH?.trim() || "/wecom/callback",
    token,
    encodingAESKey,
    corpId,
    agentId: process.env.WECOM_AGENT_ID?.trim(),
    /** 与 gettoken / 发消息一致，可用 `WECOM_CORP_SECRET` 或应用 Secret */
    corpSecret: process.env.WECOM_CORP_SECRET?.trim() ?? process.env.WECOM_SECRET?.trim(),
    plaintextMode: process.env.WECOM_PLAINTEXT_MODE === "1"
  };
}
