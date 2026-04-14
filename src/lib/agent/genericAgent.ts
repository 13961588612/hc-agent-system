import type { BaseMessage } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  isAIMessage
} from "@langchain/core/messages";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type { RunnableConfig } from "@langchain/core/runnables";
import { RunnableBinding, RunnableSequence } from "@langchain/core/runnables";
import { randomUUID } from "node:crypto";
import type { InteropZodType } from "@langchain/core/utils/types";
import {
  Annotation,
  END,
  MemorySaver,
  MessagesAnnotation,
  Send,
  START,
  StateGraph,
  isCommand,
  isGraphInterrupt
} from "@langchain/langgraph";
import { ToolNode, type ToolNodeOptions } from "@langchain/langgraph/prebuilt";
import { TOOL_HANDLERS } from "../tools/tools.js";
import type {
  GenericAgentParams,
  GenericAgentRunInput,
  GenericAgentRunResult,
  GenericAgentTool
} from "./genericAgentType.js";

function isBaseChatModel(model: unknown): model is LanguageModelLike {
  return (
    typeof model === "object" &&
    model !== null &&
    "invoke" in model &&
    typeof (model as { invoke: unknown }).invoke === "function" &&
    "_modelType" in model
  );
}

/** 从可能已 bindTools 的 runnable 中取出底层 ChatModel，供 `withStructuredOutput` 使用 */
function getBaseChatModelForStructuredOutput(llm: LanguageModelLike): LanguageModelLike {
  let model: unknown = llm;
  if (RunnableSequence.isRunnableSequence(model)) {
    model =
      model.steps.find(
        (step) => RunnableBinding.isRunnableBinding(step) || isBaseChatModel(step)
      ) ?? model;
  }
  if (RunnableBinding.isRunnableBinding(model)) {
    model = model.bound;
  }
  if (!isBaseChatModel(model)) {
    throw new Error("通用 Agent 的 structuredResponse 需要支持 withStructuredOutput 的 ChatModel");
  }
  return model as LanguageModelLike;
}

function bindToolsToModel(
  llm: LanguageModelLike,
  toolList: GenericAgentTool[],
  strictFunctionTool: boolean | undefined
): LanguageModelLike {
  if (toolList.length === 0) {
    return llm;
  }
  const bindTools = (llm as { bindTools?: (t: unknown[], o?: { strict?: boolean }) => unknown })
    .bindTools;
  if (typeof bindTools !== "function") {
    throw new Error("通用 Agent 需要支持 bindTools 的 chat model");
  }
  return bindTools.call(llm, toolList, strictFunctionTool === true ? { strict: true } : undefined) as LanguageModelLike;
}

/** 与 `intentToolRunner` 一致：参数键排序后 JSON，用于「同工具 + 同参」去重 */
function toolArgsCacheKey(args: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(args).sort()) {
    sorted[k] = args[k];
  }
  return JSON.stringify(sorted);
}

/**
 * 写入 `invoke` 的 `config.configurable`，使工具结果缓存仅在「单次图 invoke」内跨 agent↔tools 多轮共享；
 * 新一次 `runGenericAgent` 会换会话 id，避免与上一轮请求串缓存。
 */
export const GENERIC_AGENT_TOOL_DEDUPE_SESSION_KEY = "__generic_agent_tool_dedupe_session";

type CachedToolPayload = { status: "success" | "error"; content: string; name?: string };

type LangGraphToolCall = Parameters<ToolNode["runTool"]>[0];
type LangGraphToolRunResult = Awaited<ReturnType<ToolNode["runTool"]>>;

type WithStructuredRoute = typeof END | "tools" | "generate_structured_response" | Send[];
type MessagesOnlyRoute = typeof END | "tools" | Send[];

/**
 * LangGraph `ToolNode` 的薄封装：统一节点名、错误策略；
 * 参考意图阶段：对「同工具 + 同参」做结果缓存；**在 `TOOL_HANDLERS` 中有登记的工具名**走 `TOOL_HANDLERS` 执行（与 `intentToolRunner` 一致），其余回退基类 `runTool`（LangChain `tool.invoke`）。
 */
export class GenericAgentToolNode extends ToolNode {
  private readonly useToolResultCache: boolean;
  private readonly cacheToolResults: boolean;
  private readonly crossRoundCache = new Map<string, string>();
  private dedupeSession: string | undefined;
  private activeToolResultCache = new Map<string, string>();

  constructor(
    tools: GenericAgentTool[],
    options?: ToolNodeOptions & {
      agentName?: string;
      /** 是否读取「同工具 + 同参」缓存，默认 true */
      useToolResultCache?: boolean;
      /** 是否写入上述缓存，默认 true */
      cacheToolResults?: boolean;
    }
  ) {
    const { agentName, useToolResultCache, cacheToolResults, ...rest } = options ?? {};
    super(tools, {
      name: rest.name ?? (agentName != null ? `${agentName}_tools` : "generic_agent_tools"),
      tags: rest.tags,
      handleToolErrors: rest.handleToolErrors ?? true
    });
    this.useToolResultCache = useToolResultCache !== false;
    this.cacheToolResults = cacheToolResults !== false;
  }

  override async run(input: unknown, config?: RunnableConfig): Promise<unknown> {
    const session = config?.configurable?.[GENERIC_AGENT_TOOL_DEDUPE_SESSION_KEY] as
      | string
      | undefined;
    if (session != null && session !== "") {
      if (this.dedupeSession !== session) {
        this.crossRoundCache.clear();
        this.dedupeSession = session;
      }
      this.activeToolResultCache = this.crossRoundCache;
    } else {
      this.activeToolResultCache = new Map();
    }
    return super.run(input, config ?? {});
  }

  override async runTool(
    call: LangGraphToolCall,
    config: RunnableConfig
  ): Promise<LangGraphToolRunResult> {
    const name = call.name;
    const args = (call.args ?? {}) as Record<string, unknown>;
    const dedupeKey = `${name}\0${toolArgsCacheKey(args)}`;
    const cached =
      this.useToolResultCache ? this.activeToolResultCache.get(dedupeKey) : undefined;
    if (cached !== undefined) {
      try {
        const p = JSON.parse(cached) as CachedToolPayload;
        return new ToolMessage({
          status: p.status,
          name: p.name ?? name,
          content: p.content,
          tool_call_id: call.id ?? ""
        }) as LangGraphToolRunResult;
      } catch {
        return new ToolMessage({
          status: "success",
          name,
          content: cached,
          tool_call_id: call.id ?? ""
        }) as LangGraphToolRunResult;
      }
    }

    const putToolResultInCache = (msg: ToolMessage) => {
      if (!this.cacheToolResults) return;
      const content =
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const status = (msg.status === "error" ? "error" : "success") as CachedToolPayload["status"];
      this.activeToolResultCache.set(
        dedupeKey,
        JSON.stringify({
          status,
          content,
          name: msg.name ?? name
        } satisfies CachedToolPayload)
      );
    };

    const handler = TOOL_HANDLERS[name];
    if (handler) {
      try {
        const raw = await handler(args);
        const out = new ToolMessage({
          status: "success",
          name,
          content: typeof raw === "string" ? raw : String(raw),
          tool_call_id: call.id ?? ""
        });
        putToolResultInCache(out);
        return out as LangGraphToolRunResult;
      } catch (e) {
        if (!this.handleToolErrors) throw e;
        if (isGraphInterrupt(e)) throw e;
        const errText = e instanceof Error ? e.message : String(e);
        const out = new ToolMessage({
          status: "error",
          name,
          content: `Error: ${errText}\n Please fix your mistakes.`,
          tool_call_id: call.id ?? ""
        });
        putToolResultInCache(out);
        return out as LangGraphToolRunResult;
      }
    }

    const out = await super.runTool(call, config);
    if (isCommand(out)) {
      return out;
    }
    if (out instanceof ToolMessage) {
      putToolResultInCache(out);
    }
    return out;
  }
}

function buildGenericAgentStateAnnotation() {
  return Annotation.Root({
    ...MessagesAnnotation.spec,
    structuredResponse: Annotation<unknown>()
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
 * 使用 LangGraph 手搓 ReAct：`agent` 节点 + 自定义 {@link GenericAgentToolNode}，可选结构化输出节点。
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
  const { threadId, strictFunctionTool, useToolResultCache, cacheToolResults } = runtime;

  const checkpointer = threadId?.trim() ? new MemorySaver() : undefined;
  const version = toolNodeVersion ?? "v1";

  const resolvedSystemPrompt = mergeSystemPromptWithStructuredFormat(systemPrompt, resultSchema);
  const systemMessage = new SystemMessage(resolvedSystemPrompt);

  const modelWithTools = bindToolsToModel(model, tools, strictFunctionTool);

  const StateAnnotation = buildGenericAgentStateAnnotation();
  type AgentState = typeof StateAnnotation.State;

  const toolNode = new GenericAgentToolNode(tools, {
    agentName: name,
    useToolResultCache,
    cacheToolResults
  });

  const callAgent = async (state: AgentState, config: RunnableConfig) => {
    const msgs = [systemMessage, ...state.messages];
    const response = await modelWithTools.invoke(msgs, config);
    const ai = response as BaseMessage;
    if (AIMessage.isInstance(ai)) {
      ai.name = name;
      if (ai.lc_kwargs && typeof ai.lc_kwargs === "object") {
        (ai.lc_kwargs as { name?: string }).name = name;
      }
    }
    return { messages: [ai] };
  };

  if (resultSchema != null) {
    const generateStructuredResponse = async (state: AgentState, config: RunnableConfig) => {
      const baseModel = getBaseChatModelForStructuredOutput(model);
      const withSo = baseModel as unknown as {
        withStructuredOutput: (
          schema: InteropZodType<TResult & Record<string, unknown>>,
          options?: { strict?: boolean }
        ) => { invoke: (input: unknown, c?: RunnableConfig) => Promise<unknown> };
      };
      const parserModel = withSo.withStructuredOutput(
        resultSchema as InteropZodType<TResult & Record<string, unknown>>,
        { strict: structuredOutputStrict ?? false }
      );
      const structuredResponse = (await parserModel.invoke(state.messages, config)) as TResult;
      return { structuredResponse };
    };

    const routeAfterAgent = (state: AgentState): WithStructuredRoute => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (AIMessage.isInstance(lastMessage) && (lastMessage.tool_calls?.length ?? 0) > 0) {
        if (version === "v2") {
          return (
            lastMessage.tool_calls?.map(
              (toolCall) =>
                new Send("tools", {
                  ...state,
                  lg_tool_call: toolCall
                })
            ) ?? "tools"
          );
        }
        return "tools";
      }
      return "generate_structured_response";
    };

    return new StateGraph(StateAnnotation)
      .addNode("agent", callAgent)
      .addNode("tools", toolNode)
      .addNode("generate_structured_response", generateStructuredResponse)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", routeAfterAgent, {
        tools: "tools",
        generate_structured_response: "generate_structured_response"
      })
      .addEdge("tools", "agent")
      .addEdge("generate_structured_response", END)
      .compile({ checkpointer, name, description });
  }

  const routeAfterAgent = (state: AgentState): MessagesOnlyRoute => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (AIMessage.isInstance(lastMessage) && (lastMessage.tool_calls?.length ?? 0) > 0) {
      if (version === "v2") {
        return (
          lastMessage.tool_calls?.map(
            (toolCall) =>
              new Send("tools", {
                ...state,
                lg_tool_call: toolCall
              })
          ) ?? "tools"
        );
      }
      return "tools";
    }
    return END;
  };

  return new StateGraph(StateAnnotation)
    .addNode("agent", callAgent)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      [END]: END
    })
    .addEdge("tools", "agent")
    .compile({ checkpointer, name, description });
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

  const messages = input.messages ?? [new HumanMessage(input.userInput)];

  const configurable: Record<string, string> = {
    [GENERIC_AGENT_TOOL_DEDUPE_SESSION_KEY]: randomUUID()
  };
  if (threadId?.trim()) {
    configurable.thread_id = threadId.trim();
  }
  if (taskId?.trim()) {
    configurable.task_id = taskId.trim();
  }

  const invokeConfig: RunnableConfig = {
    recursionLimit,
    configurable
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
