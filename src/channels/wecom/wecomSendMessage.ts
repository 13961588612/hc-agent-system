import { WeCom } from "wecom-webhook-sdk";
import { getWeComAccessToken } from "./wecomAccessToken.js";
import type { WeComChannelConfig } from "./wecomConfig.js";

const webhookClients = new Map<string, WeCom>();

function getWeComWebhookClient(key: string): WeCom {
  let c = webhookClients.get(key);
  if (!c) {
    c = new WeCom({ wecom_key: key });
    webhookClients.set(key, c);
  }
  return c;
}

async function sendViaAppMessage(
  corpId: string,
  corpSecret: string,
  agentId: string,
  toUser: string,
  content: string
): Promise<void> {
  const accessToken = await getWeComAccessToken(corpId, corpSecret);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`;
  const body = {
    touser: toUser,
    msgtype: "text" as const,
    agentid: Number(agentId),
    text: { content }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as { errcode: number; errmsg?: string };
  if (data.errcode !== 0) {
    throw new Error(`[WeCom] message/send 失败: ${data.errmsg ?? ""} (${data.errcode})`);
  }
}

async function sendViaWebhook(webhookKey: string, content: string): Promise<void> {
  const wecom = getWeComWebhookClient(webhookKey);
  const result = await wecom.sendWeComMessage("text", {
    text: { content }
  });
  const ok = typeof result.status === "number" && result.status === 200;
  if (!ok) {
    throw new Error(`[WeCom] webhook 发送失败: ${String((result as { msg?: unknown }).msg ?? "unknown")}`);
  }
}

/**
 * 发送文本回复：
 * - 若配置了 `webhookKey`：使用 `wecom-webhook-sdk` 调群机器人 Webhook（消息发往该 Webhook 所在群），不依赖用户 ID。
 * - 否则：使用应用 `message/send`（需 `corpSecret`、`agentId`，且 `toUser` 有效）。
 */
export async function sendWeComTextMessage(
  cfg: Pick<WeComChannelConfig, "corpId" | "corpSecret" | "http">,
  toUser: string,
  content: string
): Promise<void> {
  const clipped = content.slice(0, 2048);
  const key = cfg?.http?.webhookKey?.trim();
  if (key) {
    await sendViaWebhook(key, clipped);
    return;
  }
  if (cfg.corpSecret && cfg?.http?.agentId && toUser !== "unknown") {
    await sendViaAppMessage(cfg?.corpId, cfg?.corpSecret, cfg?.http?.agentId, toUser, clipped);
    return;
  }
  throw new Error("[WeCom] 未配置 WECOM_WEBHOOK_KEY，且不满足应用发消息条件（corpSecret、agentId、有效用户）");
}
