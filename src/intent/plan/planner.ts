import type { IntentResult } from "../../contracts/intentSchemas.js";
import { getIntentResultSchema } from "../../contracts/intentSchemas.js";
import { getSkillDetailById, listSkillsByDomainSegment } from "../../lib/skills/catalog.js";
import type { SkillGuideEntry } from "../../lib/guides/types.js";
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
import { buildSeedIntentResultFromIntentSeparate } from "../separate/intentSeparateSeed.js";
import { IntentSeparateResult } from "../separate/intentSeparateSchema.js";

/** 程序化规划阶段统计信息 */
export interface DeterministicPlanningStats {
  /** 复用到历史 step 模板的次数 */
  reuseHit: number;
  /** 未命中历史 step 模板、需新建规划的次数 */
  reuseMiss: number;
  /** 本轮实际生成的 data_query 任务数 */
  generatedTasks: number;
}

/** 程序化回写返回结构 */
interface ProgrammaticRewriteResult {
  /** 回写后的 intent */
  intent: IntentResult;
  /** 全局去重后的缺失参数列表（用于澄清提问） */
  uniqueMissing: string[];
}

/** 将任意值规范化为非空字符串；空值返回 undefined */
function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/** 按候选 key 顺序从 slots 取第一个可用值 */
function fromSlots(slots: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = toStr(slots[k]);
    if (v) return v;
  }
  return undefined;
}

/** 从 guide 元数据提取必填参数名列表 */
function extractGuideRequiredParams(skillId: string): string[] {
  const detail = getSkillDetailById(skillId);
  if (!detail || typeof detail !== "object") return [];
  const d = detail as Record<string, unknown>;
  const skill = d.skill;
  if (!skill || typeof skill !== "object") return [];
  const g = skill as SkillGuideEntry;
  return (g.params?.required ?? [])
    .map((p) => toStr(p.name))
    .filter((x): x is string => Boolean(x));
}

/**
 * 依据用户输入+目标语义做轻量启发式打分，选择最可能命中的 skill。
 * 说明：这里是兜底选型，不替代后续 LLM/执行阶段校正。
 */
function pickBestSkillId(
  userInput: string,
  goal: string | undefined,
  segmentId: string
): string | undefined {
  const skills = listSkillsByDomainSegment("data_query", segmentId);
  if (skills.length === 0) return undefined;
  const text = `${userInput} ${goal ?? ""}`.toLowerCase();
  const scored = skills.map((s) => {
    const id = s.id.toLowerCase();
    const name = s.name.toLowerCase();
    const desc = (s.description ?? "").toLowerCase();
    let score = 0;
    if (text.includes("手机号") && (id.includes("mobile") || name.includes("手机"))) score += 6;
    if (text.includes("卡号") && (id.includes("card") || name.includes("卡号"))) score += 6;
    if ((text.includes("流水") || text.includes("明细")) && id.includes("ledger")) score += 7;
    if ((text.includes("生日") || text.includes("变更")) && id.includes("change")) score += 7;
    if (text.includes("积分") && id.includes("points")) score += 5;
    if (text.includes("档案") && id.includes("profile")) score += 4;
    return { id: s.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? skills[0]?.id;
}

/**
 * 为单个参数补值：
 * - 优先从 resolvedSlots 同义 key 取值
 * - 若缺失，按参数类型尝试从用户原文正则提取
 */
function providedValueForParam(
  param: string,
  slots: Record<string, unknown>,
  userInput: string
): string | undefined {
  switch (param) {
    case "vipId":
      return fromSlots(slots, ["vipId", "vipIds", "user_id", "userId", "hyid"]);
    case "memberCardNo":
      return (
        fromSlots(slots, ["memberCardNo", "memberCardNos", "member_card", "hyk_no"]) ??
        userInput.match(/(?:会员卡(?:号)?|卡号)\s*[:：是为]?\s*([0-9A-Za-z]{6,32})/)?.[1]?.trim()
      );
    case "mobile":
      return (
        fromSlots(slots, ["mobile", "mobiles", "phone", "sjhm"]) ??
        userInput.match(/1\d{10}/)?.[0]?.trim()
      );
    default:
      return fromSlots(slots, [param]);
  }
}

/** 余弦相似度 [-1,1] 映射到 [0,1]，便于作为「相似度分值」 */
function cosineToUnitInterval(cos: number): number {
  return Math.max(0, Math.min(1, (cos + 1) / 2));
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
): Promise<{ intent: IntentResult; stats: DeterministicPlanningStats }> {
  const stats: DeterministicPlanningStats = {
    reuseHit: 0,
    reuseMiss: 0,
    generatedTasks: 0
  };
  try {
    // const programmatic = await applyProgrammaticPlanningRewrite(intent, userInput, stats);
    // const withTone =
    //   programmatic.uniqueMissing.length > 0
    //     ? await applyLlmHumorousPlanning(programmatic.intent, programmatic.uniqueMissing)
    //     : programmatic.intent;
    // return { intent: withTone, stats };
    return { intent: await applyLlmPlanningRewrite(intent, userInput, null), stats };
  } catch (error) {
    return { intent: await applyLlmPlanningRewrite(intent, userInput, error), stats };
  }
}

/**
 * 子函数1：程序化规划回写
 * - 统一生成/补齐 planningTasks 与 skillSteps
 * - 程序判定 required/provided/missing 与 executable
 * - 回写 planPhase / needsClarification / clarificationQuestion
 */
async function applyProgrammaticPlanningRewrite(
  intent: IntentResult,
  userInput: string,
  stats: DeterministicPlanningStats
): Promise<ProgrammaticRewriteResult> {
  const ir = structuredClone(intent) as IntentResult;
  const dataQueryIntents = (ir.intents ?? []).filter((x) => x.intent === "data_query");
  if (dataQueryIntents.length === 0) return { intent: ir, uniqueMissing: [] };

  const nonDataQueryTasks = (ir.planningTasks ?? []).filter(
    (t) => (t.systemModuleId ?? "") !== "data_query"
  );
  const builtTasks: NonNullable<IntentResult["planningTasks"]> = [];
  const allMissing: string[] = [];

  for (let idx = 0; idx < dataQueryIntents.length; idx++) {
    const dq = dataQueryIntents[idx]!;
    const segmentId = toStr(dq.segmentId) ?? "member";
    const selectedSkillId =
      toStr(ir.planningTasks?.[idx]?.skillSteps?.[0]?.selectedSkillId) ??
      pickBestSkillId(userInput, dq.goal, segmentId);
    if (!selectedSkillId) continue;

    const reused = getReusableStepTemplate(segmentId, selectedSkillId);
    if (reused) stats.reuseHit += 1;
    else stats.reuseMiss += 1;

    const briefText = toStr(dq.semanticTaskBrief);
    let nextBriefEmbedding: number[] | undefined;
    if (briefText) {
      const emb = await fetchTextEmbedding(briefText);
      if (emb?.length) {
        nextBriefEmbedding = emb;
        const prev = reused?.briefEmbedding;
        if (prev?.length) {
          const a = l2Normalize(emb);
          const b = l2Normalize(prev);
          const cos = dotProduct(a, b);
          dq.semanticTaskBriefVectorSim = cosineToUnitInterval(cos);
        }
      }
    }
    const requiredParams =
      reused?.requiredParams && reused.requiredParams.length > 0
        ? reused.requiredParams
        : extractGuideRequiredParams(selectedSkillId);
    const slots = (dq.resolvedSlots ?? {}) as Record<string, unknown>;
    const providedParams: Record<string, unknown> = {};
    for (const p of requiredParams) {
      const v = providedValueForParam(p, slots, userInput);
      if (v !== undefined) providedParams[p] = v;
    }
    const missingParams = requiredParams.filter((p) => providedParams[p] === undefined);
    const taskMissing = [...missingParams];
    const executable = missingParams.length === 0;
    allMissing.push(...taskMissing);

    builtTasks.push({
      taskId: `task-dq-${idx + 1}`,
      systemModuleId: "data_query",
      goal:
        dq.goal ??
        dq.semanticTaskBrief ??
        `执行 data_query 子任务 ${idx + 1}`,
      resolvedSlots: slots,
      missingSlots: taskMissing,
      executable,
      skillSteps: [
        {
          stepId: `step-dq-${idx + 1}-1`,
          skillsDomainId: reused?.skillsDomainId ?? "data_query",
          skillsSegmentId: reused?.skillsSegmentId ?? segmentId,
          selectedSkillId,
          selectedSkillKind: reused?.selectedSkillKind ?? "guide",
          requiredParams,
          providedParams,
          missingParams,
          executable,
          executionSkillId: reused?.executionSkillId ?? "sql_query",
          dbClientKey: reused?.dbClientKey ?? segmentId,
          expectedOutput:
            reused?.expectedOutput ?? "resultType=table;resultPath=result.rows"
        }
      ],
      expectedOutput: "resultType=table;resultPath=result.rows"
    });
    stats.generatedTasks += 1;

    saveReusableStepTemplate(segmentId, {
      skillsDomainId: reused?.skillsDomainId ?? "data_query",
      skillsSegmentId: reused?.skillsSegmentId ?? segmentId,
      selectedSkillId,
      selectedSkillKind: reused?.selectedSkillKind ?? "guide",
      requiredParams,
      executionSkillId: reused?.executionSkillId ?? "sql_query",
      dbClientKey: reused?.dbClientKey ?? segmentId,
      expectedOutput:
        reused?.expectedOutput ?? "resultType=table;resultPath=result.rows",
      briefEmbedding: nextBriefEmbedding ?? reused?.briefEmbedding
    });

    dq.segmentId = segmentId;
    dq.missingSlots = taskMissing;
    dq.executable = executable;
    dq.needsClarification = taskMissing.length > 0;
    dq.domainId = dq.domainId ?? "data_query";
  }

  ir.planningTasks = [...nonDataQueryTasks, ...builtTasks];
  const uniqueMissing = [...new Set(allMissing)];
  ir.needsClarification = uniqueMissing.length > 0;
  ir.planPhase = uniqueMissing.length > 0 ? "blocked" : "ready";
  if (uniqueMissing.length > 0 && !toStr(ir.clarificationQuestion)) {
    ir.clarificationQuestion = `请补充以下信息后继续：${uniqueMissing.join("、")}`;
  }
  return { intent: ir, uniqueMissing };
}

/** 澄清文案模板回退（与历史行为一致，不调用 LLM） */
function applyHumorousPlanningLocal(
  intent: IntentResult,
  uniqueMissing: string[]
): IntentResult {
  const ir = structuredClone(intent) as IntentResult;
  const missingText = uniqueMissing.join("、");
  const playful =
    missingText.length > 0
      ? `我这边差一点点就能开跑啦 😄 还需要你补充：${missingText}`
      : "我这边还差一点信息，补齐后就能继续执行。";
  ir.clarificationQuestion = playful;
  if (!toStr(ir.replySuggestion)) {
    ir.replySuggestion = "补充上面的信息后，我会继续按规划执行并返回结果。";
  }
  return ir;
}

/**
 * 子函数2：LLM 规划（轻量文案层）
 * 仅在「缺参需澄清」场景下生成更自然的澄清话术；结构化字段由 Zod 校验，与 {@link runIntentSeparateLlm} 同源模式。
 */
async function applyLlmHumorousPlanning(
  intent: IntentResult,
  uniqueMissing: string[]
): Promise<IntentResult> {
  const timeoutMs = getIntentLlmTimeoutMs();
  log("[Intent]", "澄清文案 LLM（StructuredOutput）", `开始 timeoutMs=${timeoutMs}`);
  const t0 = Date.now();
  try {
    const base = getModelNoThinking(true) as unknown as {
      withStructuredOutput: (
        p: ReturnType<typeof getClarificationToneOutputParser>
      ) => { invoke: (input: unknown) => Promise<unknown> };
    };
    const chain = base.withStructuredOutput(getClarificationToneOutputParser());
    const raw = await Promise.race([
      chain.invoke([
        new SystemMessage(
          "你是客服助手。用户查询尚缺必要信息。请根据 missingItems 生成自然、简短的澄清问句（clarificationQuestion），" +
            "可选给出 replySuggestion。使用简体中文；须明确列出待补充项；勿编造已提供的业务数据。"
        ),
        new HumanMessage(
          JSON.stringify(
            {
              missingItems: uniqueMissing,
              priorClarification: intent.clarificationQuestion ?? null,
              priorReplySuggestion: intent.replySuggestion ?? null
            },
            null,
            2
          )
        )
      ]),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error("clarification_tone_llm_timeout")), timeoutMs);
      })
    ]);
    const parsed = ClarificationToneResultSchema.safeParse(raw);
    if (!parsed.success) {
      log("[Intent]", "澄清文案 StructuredOutput 校验失败，回退模板", parsed.error.message);
      return applyHumorousPlanningLocal(intent, uniqueMissing);
    }
    const payload = parsed.data;
    const ir = structuredClone(intent) as IntentResult;
    ir.clarificationQuestion = payload.clarificationQuestion.trim();
    const sug = toStr(payload.replySuggestion);
    if (sug) ir.replySuggestion = sug;
    else if (!toStr(ir.replySuggestion)) {
      ir.replySuggestion = "补充上面的信息后，我会继续按规划执行并返回结果。";
    }
    log("[Intent]", "澄清文案 LLM（StructuredOutput）", `结束 耗时=${Date.now() - t0}ms`);
    return ir;
  } catch (e) {
    log(
      "[Intent]",
      "澄清文案 LLM 异常，回退模板",
      e instanceof Error ? e.message : String(e)
    );
    return applyHumorousPlanningLocal(intent, uniqueMissing);
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
  if (llmPlanned) return llmPlanned;
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


