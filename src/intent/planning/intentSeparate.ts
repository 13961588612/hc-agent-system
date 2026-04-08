import type { OrchestratorState } from "../../contracts/schemas.js";
import {
  getIntentLlmTimeoutMs,
  shouldLogIntentRawLlm
} from "../../config/intentPolicy.js";
import { log } from "../../lib/log/log.js";
import {
  IntentSeparatePayloadSchema,
  type IntentSeparatePayload
} from "./intentSeparateSchema.js";
import {
  buildIntentSeparateInstruction
} from "./intentPromptUtils.js";
import { runIntentWithSkillTools } from "./intentToolRunner.js";
import { allTools } from "../../lib/tools/tools.js";

/** LLM 返回（仅关心 content / tool_calls） */
export type IntentLlmRawMessage = {
  content?: unknown;
  tool_calls?: unknown;
};

/** 阶段1：构造用户侧内容（最近对话 + 当前输入） */
export function buildIntentLlmUserContent(state: OrchestratorState): string {
  const userInput = state.input.userInput;
  const historyLines = (state.conversationTurns ?? [])
    .slice(-10)
    .map((t) => `${t.role}: ${t.content}`);
  const historyBlock =
    historyLines.length > 0
      ? `【最近对话】\n${historyLines.join("\n")}\n\n`
      : "";
  return `${historyBlock}【当前用户输入】\n${userInput}`;
}

/** 阶段2：调用意图 LLM（含工具轮与超时），拆分意图 */
export async function runIntentSeparateLlm(
  userContent: string
): Promise<IntentLlmRawMessage> {
  const instruction = buildIntentSeparateInstruction();
  const tLlm = Date.now();
  const timeoutMs = getIntentLlmTimeoutMs();
  log("[Intent]", "getModel + LLM invoke 开始", `timeoutMs=${timeoutMs}`);
  const tools = [allTools.list_skills_by_domain_segment, allTools.invoke_skill];
  const raw = await Promise.race([
    runIntentWithSkillTools(instruction, userContent, tools),
    new Promise<never>((_, rej) => {
      setTimeout(() => rej(new Error("intent_llm_timeout")), timeoutMs);
    })
  ]);
  log("[Intent]", "LLM invoke 结束（原始响应已收到）", undefined, tLlm);
  return raw as IntentLlmRawMessage;
}

/** 阶段2 附属：记录模型输出（完整或摘要） */
export function logIntentLlmModelOutput(rawMsg: IntentLlmRawMessage): void {
  if (shouldLogIntentRawLlm()) {
    log(
      "[Intent]",
      "LLM 原始返回（content + tool_calls）",
      JSON.stringify(rawMsg, null, 2)
    );
  } else {
    const c = rawMsg.content;
    const contentHint =
      typeof c === "string"
        ? `content.len=${c.length} preview=${c.slice(0, 1000)}`
        : `content.type=${typeof c}`;
    log(
      "[Intent]",
      "LLM 原始返回（摘要，完整请设 INTENT_LOG_RAW_LLM=1）",
      `${contentHint} tool_calls=${JSON.stringify(rawMsg.tool_calls ?? []).slice(0, 500)}`
    );
  }
}

/** 阶段3：解析为 Stage1 载荷 */
export function parseIntentSeparatePayload(
  rawMsg: IntentLlmRawMessage
): IntentSeparatePayload {
  const normalized = normalizeIntentPayloadForSchema(
    parseIntentPayloadFromModelContent(rawMsg.content)
  );
  return IntentSeparatePayloadSchema.parse(normalized);
}


export function parseIntentPayloadFromModelContent(content: unknown): unknown {
  if (typeof content === "string") {
    const s = content.trim();
    if (!s) return content;
    try {
      return JSON.parse(s);
    } catch {
      const first = s.indexOf("{");
      const last = s.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          return JSON.parse(s.slice(first, last + 1));
        } catch {
          return content;
        }
      }
      return content;
    }
  }
  return content;
}

export function normalizeIntentPayloadForSchema(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as Record<string, unknown>;

  const normalizeSuggestion = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((x) => x.length > 0);
      if (parts.length > 0) return parts.join(" / ");
    }
    return undefined;
  };

  const rootSuggestion = normalizeSuggestion(obj.replySuggestion);
  if (rootSuggestion) obj.replySuggestion = rootSuggestion;

  if (Array.isArray(obj.intents)) {
    obj.intents = obj.intents.map((x) => {
      if (!x || typeof x !== "object") return x;
      const item = { ...(x as Record<string, unknown>) };
      const sug = normalizeSuggestion(item.replySuggestion);
      if (sug) item.replySuggestion = sug;
      return item;
    });
  }
  return obj;
}


export async function applyIntentSeparate(state: OrchestratorState): Promise<IntentSeparatePayload> {
  const userContent = buildIntentLlmUserContent(state);
  const rawMsg = await runIntentSeparateLlm(userContent);
  logIntentLlmModelOutput(rawMsg);
  const intentSeparatePayload = parseIntentSeparatePayload(rawMsg);
  return intentSeparatePayload;
}