/** 渠道统一入站结构（企业微信等适配后写入） */
export interface InboundChannelMessage {
  channel: "wecom" | "cli" | string;
  /** 企业成员 UserId 或业务用户 id */
  userId: string;
  /** 用户文本内容 */
  text: string;
  /** 会话维度，用于 LangGraph thread_id */
  conversationId?: string;
  raw?: unknown;
}
