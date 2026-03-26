import { END, START, StateGraph } from "@langchain/langgraph";
import type { Runnable } from "@langchain/core/runnables";
import { nanoid } from "nanoid";
import { intentAgentNode } from "./intentAgentNode.js";
import { executeDataQueryNode } from "./executeDataQueryNode.js";
import { composeAnswerNode } from "./composeAnswerNode.js";
import type { OrchestratorInput } from "../../contracts/types.js";
import {
  type OrchestratorState,
  OrchestratorStateSchema
} from "../../contracts/schemas.js";

const builder = new StateGraph(OrchestratorStateSchema);

builder.addNode("intent_agent", intentAgentNode);
builder.addNode("execute_data_query", executeDataQueryNode);
builder.addNode("compose_answer", composeAnswerNode);

// LangGraph: N 推断为 "__start__"|"__end__"，需忽略节点名类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge(START, "intent_agent" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge("intent_agent" as any, "execute_data_query" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge("execute_data_query" as any, "compose_answer" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge("compose_answer" as any, END);

const orchestratorApp = builder.compile() as unknown as Runnable<
  { input: OrchestratorInput },
  { finalAnswer: unknown }
>;

export { orchestratorApp };

export async function runOrchestratorGraph(
  input: OrchestratorInput,
  config?: { configurable?: { thread_id?: string } }
) {
  const runConfig = config ?? { configurable: { thread_id: `thread-${nanoid()}` } };
  const result = await orchestratorApp.invoke({ input } as never, runConfig);
  return result.finalAnswer;
}
