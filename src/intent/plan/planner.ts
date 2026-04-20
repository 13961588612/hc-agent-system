import type { IntentResult } from "../../contracts/intentSchemas.js";
import { getIntentResultSchema } from "../../contracts/intentSchemas.js";
import { getIntentLlmTimeoutMs, getIntentToolMaxRounds } from "../../config/intentPolicy.js";
import { runGenericAgent } from "../../lib/agent/genericAgent.js";
import type { GenericAgentTool } from "../../lib/agent/genericAgentType.js";
import { allTools } from "../../lib/tools/tools.js";
import { getModel } from "../../model/index.js";
import { buildIntentTaskStepsRulesInline } from "../common/intentPromptUtils.js";
import { buildSeedIntentResultFromIntentSeparate } from "./intentSeparateSeed.js";
import type { IntentSeparateResult } from "../separate/IntentSeparateType.js";

function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function applyIntentDeterministicPlanning(
  intentSeparateResult: IntentSeparateResult,
  userInput: string
) {
  const seed = buildSeedIntentResultFromIntentSeparate(intentSeparateResult);
  return applyDeterministicDataQueryPlanning(
    getIntentResultSchema().parse(seed),
    userInput
  );
}


export async function applyDeterministicDataQueryPlanning(
  intent: IntentResult,
  userInput: string
): Promise<IntentResult> {
  try {
    return await applyLlmPlanningRewrite(intent, userInput, null);
  } catch (error) {
    return await applyLlmPlanningRewrite(intent, userInput, error);
  }
}

async function applyLlmPlanningRewrite(
  intent: IntentResult,
  userInput: string,
  error?: unknown
): Promise<IntentResult> {
  const llmPlanned = await tryBuildPlanByExternalModel(intent, userInput, error);
  if (llmPlanned) 
    return llmPlanned;
  return applyLocalPlanningFallback(intent, userInput, error);
}

function applyLocalPlanningFallback(
  intent: IntentResult,
  userInput: string,
  error?: unknown
): IntentResult {
  const ir = structuredClone(intent) as IntentResult;
  const errMsg = toStr(error instanceof Error ? error.message : error) ?? "unknown_error";
  const dataQueryIntents = (ir.intents ?? []).filter((x) => x.intent === "data_query");
  const hasDataQuery = dataQueryIntents.length > 0;
  if (!hasDataQuery) return ir;

  ir.planPhase = "blocked";
  ir.needsClarification = true;
  ir.clarificationQuestion =
    "我尝试规划执行步骤时遇到一点小波动 😅 请你补充更明确的查询对象、筛选条件和时间范围，我会立即重试。";
  ir.replySuggestion = `你刚才的问题是：「${userInput.slice(0, 120)}${userInput.length > 120 ? "..." : ""}」`;

  for (const dq of dataQueryIntents) {
    dq.executable = false;
    dq.needsClarification = true;
    dq.missingSlots = dq.missingSlots?.length ? dq.missingSlots : ["planning_context"];
  }

  const nonDataQueryTasks = (ir.planningTasks ?? []).filter(
    (t) => (t.systemModuleId ?? "") !== "data_query"
  );
  const fallbackTask = {
    taskId: "task-dq-fallback",
    systemModuleId: "data_query",
    goal: "补充信息并重新规划 data_query",
    missingSlots: ["planning_context"],
    executable: false,
    expectedOutput: "resultType=summary;resultPath=result.text"
  };
  ir.planningTasks = [...nonDataQueryTasks, fallbackTask];

  // 兜底错误信息内联到建议文案，避免依赖额外调试字段。
  ir.replySuggestion = `${ir.replySuggestion}（规划兜底原因：${errMsg}）`;
  return ir;
}

async function tryBuildPlanByExternalModel(
  intent: IntentResult,
  userInput: string,
  error?: unknown
): Promise<IntentResult | undefined> {
  const errMsg = toStr(error instanceof Error ? error.message : error) ?? "unknown_error";
  const systemPrompt = `你是 data_query 任务拆解规划器。必须使用工具 find_skills（按 domainId 列候选）与 invoke_skill（按 skillId 查看详情），辅助选定 skill；最终由结构化输出返回完整 IntentResult。
${buildIntentTaskStepsRulesInline()}`;
  const userPrompt = JSON.stringify(
    {
      cause: `programmatic_planning_failed:${errMsg}`,
      userInput,
      intent
    },
    null,
    2
  );
  const timeoutMs = getIntentLlmTimeoutMs();
  const toolRounds = getIntentToolMaxRounds();
  try {
    const { structuredResponse } = await Promise.race([
      runGenericAgent({
        name: "data_query_planning",
        systemPrompt,
        model: getModel(),
        tools: [allTools.find_skills, allTools.invoke_skill] as GenericAgentTool[],
        resultSchema: getIntentResultSchema(),
        structuredOutputStrict: true,
        runtime: {
          strictFunctionTool: true,
          recursionLimit: 6 + toolRounds * 4
        }
      }, { userInput: userPrompt }),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error("intent_llm_timeout")), timeoutMs);
      })
    ]);
    if (structuredResponse == null) return undefined;
    return getIntentResultSchema().parse(structuredResponse);
  } catch {
    return undefined;
  }
}

