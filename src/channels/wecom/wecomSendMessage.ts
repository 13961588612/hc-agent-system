import { getWeComAccessToken } from "./wecomAccessToken.js";

/** 发送应用文本消息（需 agentId、corpSecret） */
export async function sendWeComTextMessage(
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
