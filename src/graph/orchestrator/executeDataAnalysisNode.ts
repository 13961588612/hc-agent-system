import { nanoid } from "nanoid";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { getPrimaryPlanningTask, isPlanningReady } from "./intentSelectors.js";

export async function executeDataAnalysisNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  const ir = state.intentResult;
  const pt = getPrimaryPlanningTask(ir, "data_analysis");
  const ia = ir?.intents.find((x) => x.intent === "data_analysis");
  if (!ia || !isPlanningReady(ir) || ir?.needsClarification) {
    log(
      "[Orchestrator]",
      "node execute_data_analysis 跳过",
      !ia ? "no_data_analysis_intent" : !isPlanningReady(ir) ? "plan_not_ready" : "needs_clarification",
      t0
    );
    return {};
  }

  const taskId = pt?.taskId ?? nanoid();
  const summary = (pt?.goal ?? ia.goal)?.trim()
    ? `已生成数据分析任务计划：${(pt?.goal ?? ia.goal ?? "").trim()}`
    : "已生成数据分析任务计划，待分析执行器接入。";

  log("[Orchestrator]", "node execute_data_analysis 结束", `taskId=${taskId}`, t0);
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
