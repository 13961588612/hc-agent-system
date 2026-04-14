import type { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type {
  DynamicTool,
  StructuredToolInterface
} from "@langchain/core/tools";
import type { RunnableToolLike } from "@langchain/core/runnables";
import type { z } from "zod/v3";

/**
 * 与 LangGraph {@link ToolNode} / `bindTools` 一致：可执行 Tool 实例（如 `tool(...)` 返回值）。
 * 若仅有 name/description/schema，需先在业务侧用 `tool()` 包装再传入。
 */
export type GenericAgentTool =
  | StructuredToolInterface
  | DynamicTool
  | RunnableToolLike;

/** 运行期配置：会话、任务、工具 strict、图步数上限等 */
export interface GenericAgentRuntimeConfig {
  /** LangGraph checkpoint / 追踪用，对应 `config.configurable.thread_id` */
  threadId?: string;
  /** 业务任务 id，写入 `config.configurable.task_id`，便于节点或工具内读取 */
  taskId?: string;
  /**
   * 为 true 时对模型执行 `bindTools(tools, { strict: true })`（OpenAI 系与结构化输出等组合时常见要求）。
   */
  strictFunctionTool?: boolean;
  /** LangGraph 单轮 invoke 的递归/步数上限，防止工具环 */
  recursionLimit?: number;
  /**
   * 为 false 时禁用「同工具 + 同参」缓存**读取**，每次均重新执行工具（默认 true，与当前行为一致）。
   * 与 `cacheToolResults` 可独立组合。
   */
  useToolResultCache?: boolean;
  /**
   * 为 false 时禁用工具结果**写入**缓存（默认 true）。若仅关闭写入而保留读取，一般仅在同一会话内其它逻辑预填缓存时有意义。
   */
  cacheToolResults?: boolean;
}

export interface GenericAgentParams<TResult = unknown> {
  /** 图/追踪展示名 */
  name: string;
  /** 系统提示：每轮 LLM 调用前以 `SystemMessage` 置于消息列表首部 */
  systemPrompt: string;
  /** 可选：给上层 supervisor / 编排说明本 agent 职责 */
  description?: string;
  model: LanguageModelLike;
  tools: GenericAgentTool[];
  /**
   * 可选：最终态中的 `structuredResponse`（会额外触发一轮结构化输出调用）。
   * 不传则只依赖对话与工具，结果主要在 `messages` 中。
   */
  resultSchema?: z.ZodType<TResult>;
  /**
   * 与 `resultSchema` 配套，传给 `withStructuredOutput` 的 `strict`（需模型支持结构化输出路径）。
   */
  structuredOutputStrict?: boolean;
  /**
   * 工具节点路由：`v1` 单节点内并行执行本轮全部 tool_calls；`v2` 用 `Send` 将各 tool_call 分发到 `ToolNode`。
   */
  toolNodeVersion?: "v1" | "v2";
  runtime?: GenericAgentRuntimeConfig;
}

export interface GenericAgentRunInput {
  /** 单轮文本用户输入 */
  userInput: string;
  /** 若提供则优先，用于多轮（需配合 threadId + checkpointer） */
  messages?: BaseMessageLike[];
}

export interface GenericAgentRunResult<TResult = unknown> {
  messages: BaseMessage[];
  structuredResponse?: TResult;
  threadId?: string;
  taskId?: string;
}
