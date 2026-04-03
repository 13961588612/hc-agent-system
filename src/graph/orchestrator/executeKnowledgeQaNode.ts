import { nanoid } from "nanoid";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";

export async function executeKnowledgeQaNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  const ir = state.intentResult;
  const ik = ir?.intents.find((x) => x.intent === "knowledge_qa");
  if (!ik || ir?.needsClarification) {
    log(
      "[Orchestrator]",
      "node execute_knowledge_qa 跳过",
      !ik ? "no_knowledge_qa_intent" : "needs_clarification",
      t0
    );
    return {};
  }

  const taskId = nanoid();
  const summary = ik.goal?.trim()
    ? `已生成知识问答任务计划：${ik.goal.trim()}`
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
