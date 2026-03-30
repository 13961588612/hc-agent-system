import {
  END,
  START,
  MemorySaver,
  StateGraph
} from "@langchain/langgraph";
import type { Runnable } from "@langchain/core/runnables";
import { nanoid } from "nanoid";
import { intentAgentNode } from "./intentAgentNode.js";
import { guideAgentNode } from "./guideAgentNode.js";
import { executeDataQueryNode } from "./executeDataQueryNode.js";
import { composeAnswerNode } from "./composeAnswerNode.js";
import type { OrchestratorInput } from "../../contracts/types.js";
import {
  type OrchestratorState,
  OrchestratorStateSchema
} from "../../contracts/schemas.js";
import { getClarificationIdleMs } from "../../config/intentPolicy.js";
import { logDebugStep } from "../../infra/debugLog.js";

const builder = new StateGraph(OrchestratorStateSchema);

builder.addNode("intent_agent", intentAgentNode);
builder.addNode("guide_agent", guideAgentNode);
builder.addNode("execute_data_query", executeDataQueryNode);
builder.addNode("compose_answer", composeAnswerNode);

function routeAfterIntent(
  state: OrchestratorState
): "guide_agent" | "compose_answer" {
  const ir = state.intentResult;
  let next: "guide_agent" | "compose_answer";
  if (!ir) next = "compose_answer";
  else if (ir.needsClarification) next = "compose_answer";
  else if (ir.missingSlots?.length) next = "compose_answer";
  else if (ir.primaryIntent === "data_query") next = "guide_agent";
  else next = "compose_answer";
  logDebugStep(
    "[Orchestrator]",
    "route_after_intent",
    `next=${next} primaryIntent=${ir?.primaryIntent ?? "none"} needsClarification=${String(ir?.needsClarification)} missingSlots=${(ir?.missingSlots ?? []).join(",") || "none"} targetIntent=${ir?.targetIntent ?? ""}`
  );
  return next;
}

function routeAfterGuide(
  state: OrchestratorState
): "execute_data_query" | "compose_answer" {
  const m = state.guideMissingParams;
  if (m && m.length > 0) return "compose_answer";
  if (state.guidePhase === "awaiting_slot") return "compose_answer";
  return "execute_data_query";
}

// LangGraph: N 推断为 "__start__"|"__end__"，需忽略节点名类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge(START, "intent_agent" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addConditionalEdges("intent_agent" as any, routeAfterIntent as any, {
  guide_agent: "guide_agent",
  compose_answer: "compose_answer"
} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addConditionalEdges("guide_agent" as any, routeAfterGuide as any, {
  execute_data_query: "execute_data_query",
  compose_answer: "compose_answer"
} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge("execute_data_query" as any, "compose_answer" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge("compose_answer" as any, END);

const checkpointer = new MemorySaver();

const orchestratorApp = builder.compile({ checkpointer }) as unknown as Runnable<
  { input: OrchestratorInput },
  { finalAnswer: unknown }
> & {
  getState?: (config: {
    configurable?: { thread_id?: string };
  }) => Promise<{ values?: OrchestratorState }>;
};

export { orchestratorApp };

export async function runOrchestratorGraph(
  input: OrchestratorInput,
  config?: { configurable?: { thread_id?: string } }
) {
  const runConfig =
    config ?? { configurable: { thread_id: `thread-${nanoid()}` } };
  const threadId = runConfig.configurable?.thread_id ?? "";
  const t0 = Date.now();
  logDebugStep(
    "[Orchestrator]",
    "graph invoke 开始",
    `thread_id=${threadId} channel=${input.channel ?? ""} userInputLen=${input.userInput.length}`
  );

  const patch: Record<string, unknown> = {
    input,
    conversationTurns: [{ role: "user" as const, content: input.userInput }]
  };

  const idleMs = getClarificationIdleMs();
  if (orchestratorApp.getState) {
    try {
      const snap = await orchestratorApp.getState(runConfig);
      const prev = snap?.values as OrchestratorState | undefined;
      const lastCl = prev?.lastClarificationAtMs;
      if (
        typeof lastCl === "number" &&
        lastCl > 0 &&
        Date.now() - lastCl > idleMs
      ) {
        patch.clarificationRound = 0;
        patch.lastClarificationAtMs = 0;
        logDebugStep(
          "[Orchestrator]",
          "澄清空闲超时，重置追问计数",
          `idleMs=${idleMs}`
        );
      }
    } catch {
      /* 首轮无 checkpoint */
    }
  }

  const result = (await orchestratorApp.invoke(
    patch as never,
    runConfig
  )) as { finalAnswer?: unknown };
  const fa = result.finalAnswer;
  const faHint =
    fa && typeof fa === "object" && fa !== null && "type" in fa
      ? String((fa as { type: unknown }).type)
      : typeof fa;
  logDebugStep(
    "[Orchestrator]",
    "graph invoke 结束",
    `finalAnswer.type=${faHint}`,
    t0
  );
  return result.finalAnswer;
}
