import { nanoid } from "nanoid";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { getPrimaryPlanningTask, isPlanningReady } from "./intentSelectors.js";

export async function executeKnowledgeQaNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  const ir = state.intentResult;
  const pt = getPrimaryPlanningTask(ir, "knowledge_qa");
  const ik = ir?.intents.find((x) => x.intent === "knowledge_qa");
  if (!ik || !isPlanningReady(ir) || ir?.needsClarification) {
    log(
      "[Orchestrator]",
      "node execute_knowledge_qa 跳过",
      !ik ? "no_knowledge_qa_intent" : !isPlanningReady(ir) ? "plan_not_ready" : "needs_clarification",
      t0
    );
    return {};
  }

  const taskId = pt?.taskId ?? nanoid();
  const summary = (pt?.goal ?? ik.goal)?.trim()
    ? `已生成知识问答任务计划：${(pt?.goal ?? ik.goal ?? "").trim()}`
    : "已生成知识问答任务计划，待知识检索执行器接入。";

  log("[Orchestrator]", "node execute_knowledge_qa 结束", `taskId=${taskId}`, t0);
  return {
    resultsIndex: {
      ...(state.resultsIndex ?? {}),
      [taskId]: {
        status: "success",
        summary
      }
    }
  };
}
