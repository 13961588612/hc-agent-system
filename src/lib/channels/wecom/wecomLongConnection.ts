import {
  WSClient,
  generateReqId,
  type WsFrame,
  type TextMessage
} from "@wecom/aibot-node-sdk";
import type { EnvConfig } from "../../../config/envConfig.js";
import { log } from "../../log/log.js";
import { runOrchestratorGraph } from "../../../graph/orchestrator/orchestratorGraph.js";
import type { WeComChannelConfig } from "./wecomConfig.js";
import { formatFinalAnswerForChannel } from "./wecomReplyFormat.js";

/** 进度缓存：同一 streamId 多条 onProgress 合并后再发；超过此时长剔除 */
const STREAM_PROGRESS_TTL_MS = 60 * 60 * 1000;
/** 最多保留的 streamId 条数（超出则按最久未更新淘汰） */
const STREAM_PROGRESS_MAX_ENTRIES = 100;
const REPLY_STREAM_MAX_CHARS = 20480;

const PROGRESS_LINE_PREFIX = "\u23f3 ";

type StreamProgressEntry = {
  /** 每条 onProgress 原文；下发时多行拼接，行首带进度前缀 */
  chunks: string[];
  lastMs: number;
};

const streamProgressById = new Map<string, StreamProgressEntry>();

function pruneStreamProgressCache(now: number): void {
  for (const [id, ent] of streamProgressById) {
    if (now - ent.lastMs > STREAM_PROGRESS_TTL_MS) {
      streamProgressById.delete(id);
    }
  }
  while (streamProgressById.size > STREAM_PROGRESS_MAX_ENTRIES) {
    let oldestId: string | undefined;
    let oldestMs = Infinity;
    for (const [id, ent] of streamProgressById) {
      if (ent.lastMs < oldestMs) {
        oldestMs = ent.lastMs;
        oldestId = id;
      }
    }
    if (oldestId !== undefined) streamProgressById.delete(oldestId);
    else break;
  }
}

/** 追加一条进度并返回当前应下发给客户端的完整累加正文（超长时保留末尾一段） */
function appendStreamProgress(streamId: string, message: string, now: number): string {
  pruneStreamProgressCache(now);
  let ent = streamProgressById.get(streamId);
  if (!ent) {
    ent = { chunks: [], lastMs: now };
    streamProgressById.set(streamId, ent);
    pruneStreamProgressCache(now);
  }
  ent.chunks.push(message);
  ent.lastMs = now;
  const full = ent.chunks.map((m) => `${PROGRESS_LINE_PREFIX}${m}`).join("\n");
  return full.length <= REPLY_STREAM_MAX_CHARS
    ? full
    : full.slice(full.length - REPLY_STREAM_MAX_CHARS);
}

function clearStreamProgress(streamId: string): void {
  streamProgressById.delete(streamId);
}

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

    let streamId = "";
    try {
      const tAll = Date.now();
      streamId = generateReqId("stream");
      log("[WeCom-WS]", "runOrchestratorGraph 调用前", `thread_id=${threadId}`);
      const result = await runOrchestratorGraph(
        {
          userInput: text,
          userId,
          channel: "wecom",
          env
        },
        { configurable: { thread_id: threadId } },
        {
          /** 与 {@link registerProgressHandler} 一致：首参为 thread_id，次参为进度文案 */
          onProgress: async (_threadId: string, message: string) => {
            const payload = appendStreamProgress(streamId, message, Date.now());
            await wsClient.replyStream(
              { headers: frame.headers },
              streamId,
              payload,
              false
            );
          }
        }
      );
      log("[WeCom-WS]", "runOrchestratorGraph 返回", undefined, tAll);
      log(
        "[WeCom-WS]",
        "finalAnswer JSON",
        JSON.stringify(result).slice(0, 2000)
      );

      const replyText = formatFinalAnswerForChannel(result);
      const tReply = Date.now();
      log(
        "[WeCom-WS]",
        "replyStream 发送前",
        `replyLen=${replyText.length}`
      );
      await wsClient.replyStream(
        { headers: frame.headers },
        streamId,
        replyText.slice(0, REPLY_STREAM_MAX_CHARS),
        true
      );
      log("[WeCom-WS]", "replyStream 完成", undefined, tReply);
      log("[WeCom-WS]", "本条消息处理完成", undefined, tAll);
    } catch (e) {
      console.error("[WeCom-WS] 编排或回复失败:", e);
      try {
        const errStreamId = generateReqId("stream");
        await wsClient.replyStream(
          { headers: frame.headers },
          errStreamId,
          `处理失败：${e instanceof Error ? e.message : String(e)}`.slice(
            0,
            REPLY_STREAM_MAX_CHARS
          ),
          true
        );
      } catch (replyErr) {
        console.error("[WeCom-WS] 错误回复发送失败:", replyErr);
      }
    } finally {
      if (streamId) clearStreamProgress(streamId);
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
