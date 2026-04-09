import { runIntentClassifyAgent } from "../../agents/intentClassifyAgent.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { getDominantIntentFromList } from "./intentSelectors.js";
import { emitProgressByConfig } from "./progressReporter.js";

function buildIntentProgressSteps(
  state: OrchestratorState,
  out: Pick<
    OrchestratorState,
    "intentResult" | "highLevelDomain" | "intentPlanningStats"
  >
): string[] {
  const steps: string[] = [];
  const ir = out.intentResult;
  const intents = ir?.intents ?? [];
  const domainHint = intents
    .map((x) => x.intent)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .join(" / ");
  steps.push(
    `步骤1：已完成意图切分（${domainHint || "unknown"}，共 ${intents.length} 个子意图）`
  );

  const dqIntents = intents.filter((x) => x.intent === "data_query");
  if (dqIntents.length > 0) {
    const segHint = dqIntents
      .map((x) => x.segmentId)
      .filter((x): x is string => Boolean(x))
      .filter((x, i, arr) => arr.indexOf(x) === i)
      .join(" / ");
    steps.push(
      `步骤2：data_query 子意图已完成参数识别准备（segment=${segHint || "未定"}）`
    );
  } else {
    steps.push("步骤2：当前无 data_query 子意图，跳过参数识别");
  }

  const taskCount = ir?.planningTasks?.length ?? 0;
  steps.push(`步骤3：任务规划完成（planningTasks=${taskCount}）`);
  const hit = out.intentPlanningStats?.reuseHit ?? 0;
  const miss = out.intentPlanningStats?.reuseMiss ?? 0;
  steps.push(`步骤3-复用：可复用计划命中=${hit}，未命中=${miss}`);
  return steps;
}

export async function intentAgentNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  await emitProgressByConfig(config, "正在执行：步骤1 意图切分");
  log("[Orchestrator]", "node intent_agent 开始");
  const out = await runIntentClassifyAgent(state,config);
  const intentProgressSteps = buildIntentProgressSteps(state, out);
  log(
    "[Orchestrator]",
    "node intent_agent 结束",
    `dominantIntent=${getDominantIntentFromList(out.intentResult)} intents=${out.intentResult?.intents?.length ?? 0} highLevelDomain=${out.highLevelDomain ?? ""}`,
    t0
  );
  log("[Orchestrator]", "intent_agent 步骤信息", intentProgressSteps.join(" | "));
  for (const s of intentProgressSteps) {
    await emitProgressByConfig(config, s);
  }
  return {
    ...out,
    intentProgressSteps
  };
}
