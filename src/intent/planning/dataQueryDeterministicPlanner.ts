import type { IntentResult } from "../../contracts/intentSchemas.js";
import { getSkillDetailById, listSkillsByDomainSegment } from "../../lib/skills/catalog.js";
import type { SkillGuideEntry } from "../../lib/guides/types.js";
import {
  getReusableStepTemplate,
  saveReusableStepTemplate
} from "./planReuseStore.js";
import {
  dotProduct,
  fetchTextEmbedding,
  l2Normalize
} from "../../intent/planning/textEmbedding.js";

export interface DeterministicPlanningStats {
  reuseHit: number;
  reuseMiss: number;
  generatedTasks: number;
}

function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function fromSlots(slots: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = toStr(slots[k]);
    if (v) return v;
  }
  return undefined;
}

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
  const ir = structuredClone(intent) as IntentResult;
  const dataQueryIntents = (ir.intents ?? []).filter((x) => x.intent === "data_query");
  const stats: DeterministicPlanningStats = {
    reuseHit: 0,
    reuseMiss: 0,
    generatedTasks: 0
  };
  if (dataQueryIntents.length === 0) return { intent: ir, stats };

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
  return { intent: ir, stats };
}

