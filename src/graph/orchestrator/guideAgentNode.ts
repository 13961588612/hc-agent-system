import type { GuideParamsBlock, GuideEntry } from "../../lib/guides/types.js";
import {
  findGuideByKey,
  listGuides
} from "../../lib/guides/guideRegistry.js";
import { validateGuideSlots } from "../../lib/guides/slotValidation.js";
import {
  bindSqlTemplate,
  extractFirstSqlTemplate
} from "../../lib/guides/sqlTemplateBind.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { emitProgressByConfig } from "./progressReporter.js";
import {
  getBestDataQueryIntent,
  getPrimaryPlanningTask,
  isPlanningReady
} from "./intentSelectors.js";

function normalizeStringList(v: unknown, max: number): string[] {
  if (Array.isArray(v)) {
    return v
      .slice(0, max)
      .map((x) => String(x).trim())
      .filter(Boolean);
  }
  if (v === undefined || v === null) return [];
  const s = String(v).trim();
  return s ? [s] : [];
}

const SLOT_ALIAS: Record<string, string[]> = {
  vipId: ["vipId", "vipIds", "user_id", "userId", "hyid"],
  memberCardNo: ["memberCardNo", "memberCardNos", "member_card", "hyk_no"],
  mobile: ["mobile", "mobiles", "phone", "sjhm"],
  phone: ["phone", "mobile", "sjhm"],
  member_id: ["member_id", "user_id", "userId", "hyid"]
};

function extractCardNoFromText(userInput: string): string | undefined {
  return (
    userInput.match(/(?:会员卡(?:号)?|卡号)\s*[:：是为]?\s*([0-9A-Za-z]{6,32})/)?.[1] ??
    userInput.match(/\b([0-9]{8,32})\b/)?.[1]
  )?.trim();
}

function extractPhoneFromText(userInput: string): string | undefined {
  return userInput.match(/1\d{10}/)?.[0]?.trim();
}

function slotValue(slots: Record<string, unknown>, name: string): unknown {
  for (const k of SLOT_ALIAS[name] ?? [name]) {
    const v = slots[k];
    if (v !== undefined && v !== null && String(v).trim()) return v;
  }
  return undefined;
}

function fillParamsForGuide(
  paramsBlock: GuideParamsBlock | undefined,
  slots: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const defs = [
    ...(paramsBlock?.required ?? []),
    ...(paramsBlock?.optional ?? [])
  ];
  for (const def of defs) {
    const name = def.name;
    const raw = slotValue(slots, name);
    if (raw === undefined) continue;
    const typeStr = (def.type ?? "string").toLowerCase();
    if (typeStr.includes("[]")) {
      out[name] = normalizeStringList(raw, 10);
    } else {
      const list = normalizeStringList(raw, 10);
      if (list.length > 0) out[name] = list[0];
    }
  }
  return out;
}

function scoreGuide(
  guide: GuideEntry,
  userInput: string,
  slots: Record<string, unknown>
): number {
  const text = userInput.toLowerCase();
  const id = guide.id.toLowerCase();
  const desc = (guide.description ?? "").toLowerCase();
  const title = guide.title.toLowerCase();
  let score = 0;
  if (
    (text.includes("卡号") || slots.member_card) &&
    (id.includes("card") || title.includes("卡号") || desc.includes("卡号"))
  )
    score += 4;
  if (
    (text.includes("手机号") || slots.phone) &&
    (id.includes("mobile") || title.includes("手机") || desc.includes("手机"))
  )
    score += 4;
  if (
    (text.includes("流水") || text.includes("明细")) &&
    (id.includes("ledger") || title.includes("流水"))
  )
    score += 5;
  if (
    (text.includes("生日") || text.includes("变更")) &&
    (id.includes("change_log") || title.includes("变更"))
  )
    score += 5;
  if (text.includes("档案") || text.includes("资料")) {
    if (id.includes("profile") || title.includes("档案") || desc.includes("资料")) score += 3;
  }
  if (text.includes("积分") && (id.includes("points") || title.includes("积分"))) score += 3;
  return score;
}

function resolveGuideMatch(
  state: OrchestratorState
): GuideEntry | undefined {
  const ir = state.intentResult;
  const pt = getPrimaryPlanningTask(ir, "data_query");
  const dq = getBestDataQueryIntent(ir);
  if (!ir || !dq) return undefined;
  const baseSlots = (dq.resolvedSlots ?? {}) as Record<string, unknown>;
  const slots: Record<string, unknown> = {
    ...(state.guideResolvedParams ?? {}),
    ...baseSlots
  };
  const card = extractCardNoFromText(state.input.userInput);
  const phone = extractPhoneFromText(state.input.userInput);
  if (card && !slots.member_card) slots.member_card = card;
  if (phone && !slots.phone) slots.phone = phone;
  const plannedEntry =
    pt?.skillSteps?.find((s) => s.selectedSkillId?.trim())?.selectedSkillId?.trim() ?? "";
  const key = plannedEntry || dq.targetEntryId?.trim() || "";
  if (key) {
    const hit = findGuideByKey(key);
    if (hit?.guide) return hit.guide;
  }

  const guides = listGuides().filter(
    (g) =>
      g.domain === "data_query" &&
      (!dq.segmentId || g.segment === dq.segmentId || dq.segmentId === "other")
  );
  let best: GuideEntry | undefined;
  let bestScore = -1;
  for (const g of guides) {
    const s = scoreGuide(g, state.input.userInput, slots);
    if (s > bestScore) {
      bestScore = s;
      best = g;
    }
  }
  return best ?? guides[0];
}

function shouldRunSql(guide: GuideEntry): boolean {
  const sid = guide.execution?.skillId;
  return !sid || sid === "sql-query";
}

export async function guideAgentNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  await emitProgressByConfig(config, "正在执行：步骤3 匹配Guide并绑定查询参数");
  const ir = state.intentResult;
  const dq = getBestDataQueryIntent(ir);
  if (
    !ir ||
    !isPlanningReady(ir) ||
    !dq ||
    ir.needsClarification ||
    (dq.missingSlots?.length ?? 0) > 0
  ) {
    log(
      "[Orchestrator]",
      "node guide_agent 跳过",
      !isPlanningReady(ir) ? "规划未就绪" : "非 data_query 或意图层已澄清/缺槽",
      t0
    );
    await emitProgressByConfig(config, "步骤3完成：暂无匹配 Guide");
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedSkillId: undefined,
      selectedSkillEntryId: undefined,
      guideResolvedParams: undefined
    };
  }

  const match = resolveGuideMatch(state);
  if (!match) {
    log(
      "[Orchestrator]",
      "node guide_agent 无匹配 Guide",
      `targetEntryId=${dq?.targetEntryId ?? ""}`,
      t0
    );
    await emitProgressByConfig(config, "步骤3完成：缺少执行参数，等待补充");
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedSkillId: undefined,
      selectedSkillEntryId: undefined,
      guideResolvedParams: undefined
    };
  }

  const guide = match;
  const paramsBlock: GuideParamsBlock | undefined = guide.params;
  const slots: Record<string, unknown> = {
    ...(state.guideResolvedParams ?? {}),
    ...((dq.resolvedSlots ?? {}) as Record<string, unknown>)
  };
  const card = extractCardNoFromText(state.input.userInput);
  const phone = extractPhoneFromText(state.input.userInput);
  if (card && !slots.member_card) slots.member_card = card;
  if (phone && !slots.phone) slots.phone = phone;
  let guideResolvedParams = fillParamsForGuide(paramsBlock, slots);
  const validation = validateGuideSlots(paramsBlock, guideResolvedParams);

  if (!validation.satisfied) {
    log(
      "[Orchestrator]",
      "node guide_agent 缺 Guide 槽位",
      `missing=${validation.missing.join(",")}`,
      t0
    );
    await emitProgressByConfig(config, "步骤3完成：该 Guide 非 sql-query 执行");
    return {
      guidePhase: "awaiting_slot",
      selectedSkillId: guide.id,
      selectedSkillEntryId: guide.id,
      guideResolvedParams,
      guideMissingParams: validation.missing
    };
  }

  if (!shouldRunSql(guide)) {
    log(
      "[Orchestrator]",
      "node guide_agent execution 非 sql-query",
      guide.execution?.skillId ?? "",
      t0
    );
    await emitProgressByConfig(config, "步骤3完成：未找到可执行 SQL 模板");
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedSkillId: guide.id,
      selectedSkillEntryId: guide.id,
      guideResolvedParams
    };
  }

  const rawSql = extractFirstSqlTemplate(guide.body);
  if (!rawSql?.trim()) {
    log(
      "[Orchestrator]",
      "node guide_agent 未找到 SQL 模板",
      `guide=${guide.id}`,
      t0
    );
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedSkillId: guide.id,
      selectedSkillEntryId: guide.id,
      guideResolvedParams
    };
  }

  const firstRequired = paramsBlock?.required?.[0]?.name;
  const bindValues =
    normalizeStringList(
      (firstRequired ? guideResolvedParams[firstRequired] : undefined) ??
        Object.values(guideResolvedParams)[0],
      10
    );

  try {
    const { sql, params } = bindSqlTemplate(rawSql, bindValues);
    const minC = guide.execution?.minConfidence;
    if (
      typeof minC === "number" &&
      Number.isFinite(minC) &&
      typeof ir.confidence === "number" &&
      ir.confidence < minC
    ) {
      log(
        "[Orchestrator]",
        "node guide_agent 置信度低于 minConfidence，不注入 SQL",
        `confidence=${ir.confidence} min=${minC}`,
        t0
      );
      await emitProgressByConfig(config, "步骤3完成：置信度不足，跳过执行");
      return {
        guidePhase: "skipped",
        guideMissingParams: [],
        selectedSkillId: guide.id,
        selectedSkillEntryId: guide.id,
        guideResolvedParams
      };
    }

    log(
      "[Orchestrator]",
      "node guide_agent 已绑定 SQL",
      `guide=${guide.id}`,
      t0
    );

    await emitProgressByConfig(config, "步骤3完成：Guide 参数绑定完成");
    return {
      guidePhase: "ready",
      guideMissingParams: [],
      selectedSkillId: guide.id,
      selectedSkillEntryId: guide.id,
      guideResolvedParams,
      input: {
        ...state.input,
        sqlQuery: {
          sql,
          params,
          dbClientKey: dq.segmentId ?? "member",
          label: guide.id,
          purpose: guide.id
        }
      }
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(
      "[Orchestrator]",
      "node guide_agent 模板绑定失败",
      msg.slice(0, 200),
      t0
    );
    await emitProgressByConfig(config, "步骤3完成：模板绑定失败");
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedSkillId: guide.id,
      selectedSkillEntryId: guide.id,
      guideResolvedParams
    };
  }
}
