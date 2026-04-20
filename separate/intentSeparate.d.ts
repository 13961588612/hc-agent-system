import type { OrchestratorState } from "../src/contracts/schemas.js";
import { IntentSeparateResult } from "./IntentSeparateType.js";
/** LLM 原始消息（仅在使用「手动 tool 循环」解析路径时需要） */
export type IntentLlmRawMessage = {
    content?: unknown;
    tool_calls?: unknown;
};
/** 阶段1：构造用户侧内容（最近对话 + 当前输入） */
export declare function buildIntentLlmUserContent(state: OrchestratorState): string;
/**
 * 阶段2：`bindTools` + `withStructuredOutput(StructuredOutputParser)`，
 * 一次 Runnable 内完成工具绑定与结构化意图结果解析（由 LangChain 与 Zod 校验）。
 */
export declare function runIntentSeparateLlm(userContent: string): Promise<IntentSeparateResult>;
export declare function applyIntentSeparate(state: OrchestratorState, config?: {
    configurable?: {
        thread_id?: string;
    };
}): Promise<IntentSeparateResult>;
