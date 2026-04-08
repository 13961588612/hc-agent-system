import type { OrchestratorState } from "../../contracts/schemas.js";
import {
  getIntentLlmTimeoutMs,
  shouldLogIntentRawLlm
} from "../../config/intentPolicy.js";
import { log } from "../../lib/log/log.js";
import {
  Stage1IntentPayloadSchema,
  type Stage1IntentPayload
} from "../intent-planning/stage1IntentSchema.js";
import {
  buildIntentClassifyInstruction,
  normalizeIntentPayloadForSchema,
  parseIntentPayloadFromModelContent
} from "../intent-planning/intentPromptUtils.js";
import { runIntentWithSkillTools } from "../intent-planning/intentToolRunner.js";
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
export async function runIntentClassificationLlm(
  userContent: string
): Promise<IntentLlmRawMessage> {
  const instruction = buildIntentClassifyInstruction();
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
export function parseIntentStage1Payload(
  rawMsg: IntentLlmRawMessage
): Stage1IntentPayload {
  const normalized = normalizeIntentPayloadForSchema(
    parseIntentPayloadFromModelContent(rawMsg.content)
  );
  return Stage1IntentPayloadSchema.parse(normalized);
}
