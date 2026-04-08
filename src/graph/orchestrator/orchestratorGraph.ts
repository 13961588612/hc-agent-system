import {
  END,
  START,
  MemorySaver,
  StateGraph
} from "@langchain/langgraph";
import type { Runnable } from "@langchain/core/runnables";
import { nanoid } from "nanoid";
import { intentAgentNode } from "./intentAgentNode.js";
import { planGateNode } from "./planGateNode.js";
import { guideAgentNode } from "./guideAgentNode.js";
import { executeDataQueryNode } from "./executeDataQueryNode.js";
import { executeDataAnalysisNode } from "./executeDataAnalysisNode.js";
import { executeKnowledgeQaNode } from "./executeKnowledgeQaNode.js";
import { composeAnswerNode } from "./composeAnswerNode.js";
import type { OrchestratorInput } from "../../contracts/types.js";
import {
  type OrchestratorState,
  OrchestratorStateSchema
} from "../../contracts/schemas.js";
import { getClarificationIdleMs } from "../../config/intentPolicy.js";
import { log } from "../../lib/log/log.js";
import {
  getBestDataQueryIntent,
  getDominantIntentFromList,
  hasPlanningBlockers,
  isPlanningReady
} from "./intentSelectors.js";
import {
  registerProgressHandler,
  unregisterProgressHandler
} from "./progressReporter.js";

const builder = new StateGraph(OrchestratorStateSchema);

builder.addNode("intent_agent", intentAgentNode);
builder.addNode("plan_gate", planGateNode);
builder.addNode("guide_agent", guideAgentNode);
builder.addNode("execute_data_query", executeDataQueryNode);
builder.addNode("execute_data_analysis", executeDataAnalysisNode);
builder.addNode("execute_knowledge_qa", executeKnowledgeQaNode);
builder.addNode("compose_answer", composeAnswerNode);

function routeAfterPlanGate(
  state: OrchestratorState
):
  | "guide_agent"
  | "execute_data_analysis"
  | "execute_knowledge_qa"
  | "compose_answer" {
  const ir = state.intentResult;
  const dq = getBestDataQueryIntent(ir);
  const missingSlots = dq?.missingSlots ?? [];
  const blocked = hasPlanningBlockers(ir);
  const ready = isPlanningReady(ir);
  const dominantIntent = getDominantIntentFromList(ir);
  let next:
    | "guide_agent"
    | "execute_data_analysis"
    | "execute_knowledge_qa"
    | "compose_answer";
  if (!ir || blocked || !ready) next = "compose_answer";
  else if (dominantIntent === "data_analysis") next = "execute_data_analysis";
  else if (dominantIntent === "knowledge_qa") next = "execute_knowledge_qa";
  else if (missingSlots.length) next = "compose_answer";
  else if (dq) next = "guide_agent";
  else next = "compose_answer";
  log(
    "[Orchestrator]",
    "route_after_plan_gate",
    `next=${next} planPhase=${ir?.planPhase ?? "none"} dominantIntent=${dominantIntent} needsClarification=${String(ir?.needsClarification)}`
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
builder.addEdge("intent_agent" as any, "plan_gate" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addConditionalEdges("plan_gate" as any, routeAfterPlanGate as any, {
  guide_agent: "guide_agent",
  execute_data_analysis: "execute_data_analysis",
  execute_knowledge_qa: "execute_knowledge_qa",
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
builder.addEdge("execute_data_analysis" as any, "compose_answer" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
builder.addEdge("execute_knowledge_qa" as any, "compose_answer" as any);
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
  config?: { configurable?: { thread_id?: string } },
  options?: {
    onProgress?: (message: string) => Promise<void> | void;
  }
) {
  const runConfig =
    config ?? { configurable: { thread_id: `thread-${nanoid()}` } };
  const threadId = runConfig.configurable?.thread_id ?? "";
  const t0 = Date.now();
  log(
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
        log(
          "[Orchestrator]",
          "澄清空闲超时，重置追问计数",
          `idleMs=${idleMs}`
        );
      }
    } catch {
      /* 首轮无 checkpoint */
    }
  }

  try {
    if (options?.onProgress) {
      registerProgressHandler(threadId, options.onProgress);
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
    log(
      "[Orchestrator]",
      "graph invoke 结束",
      `finalAnswer.type=${faHint}`,
      t0
    );
    return result.finalAnswer;
  } finally {
    unregisterProgressHandler(threadId);
  }
}
