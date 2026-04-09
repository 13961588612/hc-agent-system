import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { OrchestratorState } from "../../contracts/schemas.js";
import {
  getIntentLlmTimeoutMs,
  shouldLogIntentRawLlm
} from "../../config/intentPolicy.js";
import { log } from "../../lib/log/log.js";
import {
  IntentSeparateResultSchema,
  type IntentSeparateResult
} from "./intentSeparateSchema.js";
import { getIntentSeparateOutputParser } from "./intentSeparateOutputParser.js";
import { buildIntentSeparateInstruction } from "../common/intentPromptUtils.js";
import { allTools } from "../../lib/tools/tools.js";
import { getModel } from "../../model/index.js";
import { emitProgressByConfig } from "../../graph/orchestrator/progressReporter.js";

/** LLM 原始消息（仅在使用「手动 tool 循环」解析路径时需要） */
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

/**
 * 阶段2：`bindTools` + `withStructuredOutput(StructuredOutputParser)`，
 * 一次 Runnable 内完成工具绑定与结构化意图结果解析（由 LangChain 与 Zod 校验）。
 */
export async function runIntentSeparateLlm(
  userContent: string
): Promise<IntentSeparateResult> {
  const instruction = buildIntentSeparateInstruction();
  const tLlm = Date.now();
  const timeoutMs = getIntentLlmTimeoutMs();
  log("[Intent]", "getModel + LLM invoke 开始", `timeoutMs=${timeoutMs}`);

  const tools = [
    allTools.list_skills_by_domain_segment,
    allTools.invoke_skill
  ];
  const base = getModel(false,true) as unknown as {
    bindTools: (
      t: unknown[],
      kwargs?: { strict?: boolean }
    ) => {
      withStructuredOutput: (
        p: ReturnType<typeof getIntentSeparateOutputParser>
      ) => { invoke: (input: unknown) => Promise<unknown> };
    };
  };
  /** OpenAI：与 `withStructuredOutput` 联用时须 `strict: true`，否则报「Only strict function tools can be auto-parsed」 */
  const chain = base
    .bindTools(tools, { strict: true })
    .withStructuredOutput(getIntentSeparateOutputParser());

  const out = await Promise.race([
    chain.invoke([
      new SystemMessage(instruction),
      new HumanMessage(userContent)
    ]),
    new Promise<never>((_, rej) => {
      setTimeout(() => rej(new Error("intent_llm_timeout")), timeoutMs);
    })
  ]);

  log("[Intent]", "LLM invoke 结束（StructuredOutput 已解析）", JSON.stringify(out), tLlm);

  return out as IntentSeparateResult;
}


export async function applyIntentSeparate(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<IntentSeparateResult> {
  const userContent = buildIntentLlmUserContent(state);
  const intentSeparateResult: IntentSeparateResult = await runIntentSeparateLlm(userContent);
  const message = buildIntentSeparateProgressMessage(intentSeparateResult);
  try {
    await emitProgressByConfig(config, message);
  } catch (error) {
    log(
      "[Intent]",
      "emitProgressByConfig 失败",
      error instanceof Error ? error.message : String(error)
    );
  }
  
  return intentSeparateResult;
}


function buildIntentSeparateProgressMessage(intentSeparateResult: IntentSeparateResult): string {
  let message = `意图切分结束`;
  if(intentSeparateResult.replySuggestion) {
    message += `，${intentSeparateResult.replySuggestion}`;
  }
  return message;
}