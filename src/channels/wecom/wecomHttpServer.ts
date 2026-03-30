import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { EnvConfig } from "../../config/envConfig.js";
import { logDebugStep } from "../../infra/debugLog.js";
import { runOrchestratorGraph } from "../../graph/orchestrator/orchestratorGraph.js";
import type { WeComChannelConfig } from "./wecomConfig.js";
import {
  decryptEchoStr,
  decryptWeComPayload,
  extractEncryptFromXml,
  parseContentFromDecrypted,
  parseTextXmlInner,
  verifySha1Signature
} from "./wxBizMsgCrypt.js";
import { sendWeComTextMessage } from "./wecomSendMessage.js";
import { formatFinalAnswerForChannel } from "./wecomReplyFormat.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

/**
 * 启动企业微信回调 HTTP 服务（长驻进程）。
 * - GET：URL 验证，解密 echostr 并原样返回
 * - POST：解密消息体，解析文本，调用编排；可选主动发消息回复
 */
export function startWeComHttpServer(cfg: WeComChannelConfig, env: EnvConfig): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    if (url.pathname !== cfg?.http?.callbackPath) {
      send(res, 404, "not found");
      return;
    }

    if (req.method === "GET") {
      const msgSignature = url.searchParams.get("msg_signature") ?? "";
      const timestamp = url.searchParams.get("timestamp") ?? "";
      const nonce = url.searchParams.get("nonce") ?? "";
      const echostr = url.searchParams.get("echostr") ?? "";
      if (!echostr) {
        send(res, 400, "missing echostr");
        return;
      }
      if (!verifySha1Signature(cfg?.http?.token, timestamp, nonce, echostr, msgSignature)) {
        console.warn("[WeCom] GET 验签失败");
        send(res, 403, "invalid signature");
        return;
      }
      try {
        const plain = decryptEchoStr(cfg?.http?.encodingAESKey, echostr);
        send(res, 200, plain);
        console.log("[WeCom] URL 验证成功");
      } catch (e) {
        console.error("[WeCom] 解密 echostr 失败:", e);
        send(res, 500, "decrypt error");
      }
      return;
    }

    if (req.method !== "POST") {
      send(res, 405, "method not allowed");
      return;
    }

    const rawBody = await readBody(req);

    try {
      let userId = "unknown";
      let text = "";

      if (cfg?.http?.plaintextMode) {
        try {
          const j = JSON.parse(rawBody) as Record<string, unknown>;
          userId = typeof j.userId === "string" ? j.userId : typeof j.fromUserName === "string" ? j.fromUserName : "demo-user";
          text = typeof j.text === "string" ? j.text : typeof j.content === "string" ? j.content : "";
        } catch {
          send(res, 400, "invalid json in plaintext mode");
          return;
        }
      } else {
        const msgSignature =
          url.searchParams.get("msg_signature") ?? req.headers["x-wecom-signature"] ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? req.headers["x-wecom-timestamp"] ?? "";
        const nonce = url.searchParams.get("nonce") ?? req.headers["x-wecom-nonce"] ?? "";
        const encrypt = extractEncryptFromXml(rawBody);
        if (!encrypt) {
          send(res, 400, "no Encrypt in body");
          return;
        }
        if (!verifySha1Signature(cfg?.http?.token, String(timestamp), String(nonce), encrypt, String(msgSignature))) {
          console.warn("[WeCom] POST 验签失败");
          send(res, 403, "invalid signature");
          return;
        }
        const buf = decryptWeComPayload(cfg?.http?.encodingAESKey, encrypt);
        const { content } = parseContentFromDecrypted(buf);
        const inner = parseTextXmlInner(content);
        userId = inner.fromUser ?? "unknown";
        text = inner.content ?? "";
      }

      if (!text.trim()) {
        send(res, 200, "success");
        return;
      }

      const threadId = `${userId}:wecom`;
      console.log(`[WeCom] 收到消息 user=${userId} text=${text.slice(0, 200)}`);

      const tAll = Date.now();
      logDebugStep("[WeCom-HTTP]", "runOrchestratorGraph 调用前", `thread_id=${threadId}`);
      const result = await runOrchestratorGraph(
        {
          userInput: text,
          userId,
          channel: "wecom",
          env
        },
        { configurable: { thread_id: threadId } }
      );
      logDebugStep("[WeCom-HTTP]", "runOrchestratorGraph 返回", undefined, tAll);

      const replyText = formatFinalAnswerForChannel(result);

      const canSend =
        cfg?.http?.webhookKey?.trim() ||
        (cfg?.corpSecret && cfg?.http?.agentId && userId !== "unknown");
      if (canSend) {
        try {
          const tSend = Date.now();
          logDebugStep(
            "[WeCom-HTTP]",
            "sendWeComTextMessage 调用前",
            `replyLen=${replyText.length}`
          );
          await sendWeComTextMessage(cfg as WeComChannelConfig, userId, replyText);
          logDebugStep("[WeCom-HTTP]", "sendWeComTextMessage 完成", undefined, tSend);
        } catch (e) {
          console.error("[WeCom] 主动回复失败:", e);
        }
      } else {
        console.log("[WeCom] 编排结果（未配置 Webhook 或应用发消息）:", replyText.slice(0, 500));
      }

      logDebugStep("[WeCom-HTTP]", "本条消息处理完成", undefined, tAll);
      send(res, 200, "success");
    } catch (e) {
      console.error("[WeCom] POST 处理失败:", e);
      send(res, 500, "error");
    }
  });

  server.listen(cfg?.http?.port ?? 3000, () => {
    console.log(
      `[WeCom] HTTP 回调已监听 http://0.0.0.0:${cfg?.http?.port ?? 3000}${cfg?.http?.callbackPath ?? "/wecom/callback"}（生产请配 HTTPS 反代）`
    );
  });
}
