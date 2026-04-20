import type { IntentResult } from "../../contracts/intentSchemas.js";
import { getIntentResultSchema } from "../../contracts/intentSchemas.js";
import type { GuideEntry } from "../../lib/guides/types.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getIntentLlmTimeoutMs } from "../../config/intentPolicy.js";
import { log } from "../../lib/log/log.js";
import { getModel, getModelNoThinking } from "../../model/index.js";
import {
  ClarificationToneResultSchema,
  getClarificationToneOutputParser
} from "./clarificationToneOutputParser.js";
import { buildIntentTaskStepsRulesInline } from "../common/intentPromptUtils.js";
import {
  getReusableStepTemplate,
  saveReusableStepTemplate
} from "./planReuseStore.js";
import {
  dotProduct,
  fetchTextEmbedding,
  l2Normalize
} from "../common/textEmbedding.js";
import { buildSeedIntentResultFromIntentSeparate } from "../../separate/intentSeparateSeed.js";
import type { IntentSeparateResult } from "../../separate/IntentSeparateType.js";

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

/**
 * 对 data_query 做程序化规划回写：
 * - 统一生成/补齐 planningTasks 与 skillSteps
 * - 程序判定 required/provided/missing 与 executable
 * - 统一回写 planPhase / needsClarification / clarificationQuestion
 * - 对 semanticTaskBrief 做嵌入，与缓存向量算相似度写入 semanticTaskBriefVectorSim
 */
export async function applyDeterministicDataQueryPlanning(
  intent: IntentResult,
  userInput: string
): Promise<IntentResult> {
  try {
    // const programmatic = await applyProgrammaticPlanningRewrite(intent, userInput);
    // const withTone =
    //   programmatic.uniqueMissing.length > 0
    //     ? await applyLlmHumorousPlanning(programmatic.intent, programmatic.uniqueMissing)
    //     : programmatic.intent;
    // return withTone;
    return await applyLlmPlanningRewrite(intent, userInput, null);
  } catch (error) {
    return await applyLlmPlanningRewrite(intent, userInput, error);
  }
}
/**
 * 程序化规划失败时的 LLM 规划回写兜底。
 * 说明：当前实现为“LLM 风格回写”，不依赖外部模型调用，避免在失败路径引入新的不确定性。
 */
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
  const model = getModel();
  const systemPrompt = `你是 data_query 任务拆解规划器。必须使用工具 list_skills_by_domain_segment，查看skillId对应的skill信息，并选择合适的skillId。
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
  const raw = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt)
  ]);
  const parsed = parseModelJsonContent((raw as { content?: unknown }).content);
  if (!parsed) return undefined;
  return getIntentResultSchema().parse(parsed);
}

function parseModelJsonContent(content: unknown): unknown {
  if (typeof content !== "string") return undefined;
  const s = content.trim();
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(s.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}


