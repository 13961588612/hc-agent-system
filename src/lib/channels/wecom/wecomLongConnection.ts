import {
  WSClient,
  generateReqId,
  type WsFrame,
  type TextMessage
} from "@wecom/aibot-node-sdk";
import type { EnvConfig } from "../../../config/envConfig.js";
import { log } from "../../log/log.js";
import { runOrchestratorGraph } from "../../../graph/orchestrator/orchestratorGraph.js";
import type { WeComChannelConfig, WeComLongConnectionConfig } from "./wecomConfig.js";
import { formatFinalAnswerForChannel } from "./wecomReplyFormat.js";

/**
 * 启动企业微信智能机器人 WebSocket 长连接（@wecom/aibot-node-sdk），
 * 收到文本消息后调用编排，并以流式通道一次性结束回复。
 */
export function startWeComLongConnection(cfg: WeComChannelConfig, env: EnvConfig): void {
  console.log("startWeComLongConnection");
  console.log(cfg?.longConnection);

  const wsClient = new WSClient({
    botId: cfg?.longConnection?.botId,
    secret: cfg?.longConnection?.secret,
    wsUrl: cfg?.longConnection?.wsUrl
  });

  wsClient.on("error", (err: Error) => {
    console.error("[WeCom-WS] error:", err);
  });

  wsClient.on("authenticated", () => {
    console.log("[WeCom-WS] 认证成功，长连接已就绪");
  });

  wsClient.on("disconnected", (reason: string) => {
    console.warn("[WeCom-WS] 断开:", reason);
  });

  wsClient.on("message.text", async (frame: WsFrame<TextMessage>) => {
    const body = frame.body;
    const text = body?.text?.content?.trim() ?? "";
    const userId = body?.from?.userid ?? "unknown";
    if (!text) {
      return;
    }

    const threadId = `${userId}:wecom`;
    console.log(`[WeCom-WS] 收到文本 user=${userId} text=${text.slice(0, 200)}`);

    try {
      const tAll = Date.now();
      log("[WeCom-WS]", "runOrchestratorGraph 调用前", `thread_id=${threadId}`);
      const result = await runOrchestratorGraph(
        {
          userInput: text,
          userId,
          channel: "wecom",
          env
        },
        { configurable: { thread_id: threadId } }
      );
      log("[WeCom-WS]", "runOrchestratorGraph 返回", undefined, tAll);
      log(
        "[WeCom-WS]",
        "finalAnswer JSON",
        JSON.stringify(result).slice(0, 2000)
      );

      const replyText = formatFinalAnswerForChannel(result);
      const streamId = generateReqId("stream");
      const tReply = Date.now();
      log(
        "[WeCom-WS]",
        "replyStream 发送前",
        `replyLen=${replyText.length}`
      );
      await wsClient.replyStream(
        { headers: frame.headers },
        streamId,
        replyText.slice(0, 20480),
        true
      );
      log("[WeCom-WS]", "replyStream 完成", undefined, tReply);
      log("[WeCom-WS]", "本条消息处理完成", undefined, tAll);
    } catch (e) {
      console.error("[WeCom-WS] 编排或回复失败:", e);
      try {
        const streamId = generateReqId("stream");
        await wsClient.replyStream(
          { headers: frame.headers },
          streamId,
          `处理失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 20480),
          true
        );
      } catch (replyErr) {
        console.error("[WeCom-WS] 错误回复发送失败:", replyErr);
      }
    }
  });

  wsClient.connect();

  const shutdown = (): void => {
    try {
      wsClient.disconnect();
    } catch {
      /* ignore */
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
