import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage, SystemMessage, isAIMessage } from "@langchain/core/messages";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type { RunnableConfig } from "@langchain/core/runnables";
import { RunnableBinding, RunnableSequence } from "@langchain/core/runnables";
import type { InteropZodType } from "@langchain/core/utils/types";
import {
  Annotation,
  END,
  MemorySaver,
  MessagesAnnotation,
  Send,
  START,
  StateGraph
} from "@langchain/langgraph";
import { ToolNode, type ToolNodeOptions } from "@langchain/langgraph/prebuilt";
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

type WithStructuredRoute = typeof END | "tools" | "generate_structured_response" | Send[];
type MessagesOnlyRoute = typeof END | "tools" | Send[];

/**
 * LangGraph `ToolNode` 的薄封装：统一节点名、错误策略，业务可继承并覆盖 {@link ToolNode.runTool} 做日志/审计等。
 */
export class GenericAgentToolNode extends ToolNode {
  constructor(tools: GenericAgentTool[], options?: ToolNodeOptions & { agentName?: string }) {
    const { agentName, ...rest } = options ?? {};
    super(tools, {
      name: rest.name ?? (agentName != null ? `${agentName}_tools` : "generic_agent_tools"),
      tags: rest.tags,
      handleToolErrors: rest.handleToolErrors ?? true
    });
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
  const { threadId, strictFunctionTool } = runtime;

  const checkpointer = threadId?.trim() ? new MemorySaver() : undefined;
  const version = toolNodeVersion ?? "v1";

  const resolvedSystemPrompt = mergeSystemPromptWithStructuredFormat(systemPrompt, resultSchema);
  const systemMessage = new SystemMessage(resolvedSystemPrompt);

  const modelWithTools = bindToolsToModel(model, tools, strictFunctionTool);

  const StateAnnotation = buildGenericAgentStateAnnotation();
  type AgentState = typeof StateAnnotation.State;

  const toolNode = new GenericAgentToolNode(tools, { agentName: name });

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
