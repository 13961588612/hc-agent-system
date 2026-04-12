import { HumanMessage } from "@langchain/core/messages";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { InteropZodType } from "@langchain/core/utils/types";
import { MemorySaver } from "@langchain/langgraph";
import {
  createAgent,
  createMiddleware,
  providerStrategy
} from "langchain";
import type {
  GenericAgentParams,
  GenericAgentRunInput,
  GenericAgentRunResult
} from "./defaultAgentType.js";

/** 通过 `modelSettings.strict` 传给内部 `bindTools`，避免预绑定模型（createAgent 不允许已绑定 tools 的 model） */
function strictFunctionToolsMiddleware() {
  return createMiddleware({
    name: "strict_function_tools",
    wrapModelCall: async (request, handler) => {
      return handler({
        ...request,
        modelSettings: {
          ...(request.modelSettings ?? {}),
          strict: true
        }
      });
    }
  });
}

/**
 * 配置了结构化输出时，在系统提示中附加与 {@link StructuredOutputParser} 一致的格式说明，约束模型严格按 JSON 形态输出。
 */
function mergeSystemPromptWithStructuredFormat<TResult>(
  basePrompt: string,
  resultSchema: GenericAgentParams<TResult>["resultSchema"]
): string {
  if (resultSchema == null) {
    return basePrompt;
  }
  const parser = StructuredOutputParser.fromZodSchema(
    resultSchema as InteropZodType<Record<string, unknown>>
  );
  const formatInstructions = parser.getFormatInstructions();
  return `${basePrompt.trim()}\n\n【结构化输出】最终结构化结果必须严格遵循下列格式说明（与程序侧 StructuredOutputParser 解析一致），不得缺少字段、增删键名或改变嵌套结构：\n${formatInstructions}`;
}

/**
 * 按参数编译 ReAct Agent（`langchain` 的 `createAgent`），供复用或自行 `invoke` / `stream`。
 *
 * 还可按需补充的元素（未强制进参数，避免模板过重）：`store`、`interruptBefore` / `interruptAfter`、
 * 自定义 `stateSchema`、更多 `middleware` 等（见 `CreateAgentParams`）。
 */
export function createGenericAgentGraph<TResult = unknown>(
  params: GenericAgentParams<TResult>
) {
  const {
    name,
    systemPrompt,
    description,
    model,
    tools,
    resultSchema,
    structuredOutputStrict,
    toolNodeVersion,
    runtime = {}
  } = params;
  const { threadId, strictFunctionTool } = runtime;

  const checkpointer = threadId?.trim() ? new MemorySaver() : undefined;

  const middleware =
    strictFunctionTool === true ? [strictFunctionToolsMiddleware()] : undefined;

  const responseFormat =
    resultSchema != null
      ? providerStrategy({
          schema: resultSchema as InteropZodType<TResult & Record<string, unknown>>,
          strict: structuredOutputStrict ?? false
        })
      : undefined;

  const resolvedSystemPrompt = mergeSystemPromptWithStructuredFormat(
    systemPrompt,
    resultSchema
  );

  return createAgent({
    model,
    tools,
    name,
    description,
    systemPrompt: resolvedSystemPrompt,
    version: toolNodeVersion ?? "v1",
    ...(responseFormat != null ? { responseFormat } : {}),
    ...(checkpointer ? { checkpointer } : {}),
    ...(middleware != null ? { middleware } : {})
  });
}

/**
 * 创建并运行通用 ReAct 图：返回最终 state（含 `messages` 与可选 `structuredResponse`）。
 */
export async function runGenericAgent<TResult = unknown>(
  params: GenericAgentParams<TResult>,
  input: GenericAgentRunInput
): Promise<GenericAgentRunResult<TResult>> {
  const { runtime = {} } = params;
  const { threadId, taskId, recursionLimit = 25 } = runtime;

  const agent = createGenericAgentGraph(params);

  const messages =
    input.messages ?? [new HumanMessage(input.userInput)];

  const configurable: Record<string, string> = {};
  if (threadId?.trim()) {
    configurable.thread_id = threadId.trim();
  }
  if (taskId?.trim()) {
    configurable.task_id = taskId.trim();
  }

  const invokeConfig: RunnableConfig = {
    recursionLimit,
    ...(Object.keys(configurable).length > 0 ? { configurable } : {})
  };

  const state = (await agent.invoke({ messages }, invokeConfig)) as {
    messages: GenericAgentRunResult<TResult>["messages"];
    structuredResponse?: TResult;
  };

  return {
    messages: state.messages,
    structuredResponse: state.structuredResponse,
    threadId: threadId?.trim() || undefined,
    taskId: taskId?.trim() || undefined
  };
}
