import type {
  GuideCapabilityMeta,
  GuideParamsBlock,
  SkillGuideEntry
} from "../../guides/types.js";
import {
  findGuideCapabilityByKey,
  listGuides
} from "../../guides/guideRegistry.js";
import { validateGuideSlots } from "../../guides/slotValidation.js";
import {
  bindFirstInClause,
  extractCapabilitySqlTemplate
} from "../../guides/sqlTemplateBind.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { logDebugStep } from "../../infra/debugLog.js";

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
  vipIds: ["vipIds", "user_id", "userId", "hyid"],
  memberCardNos: ["memberCardNos", "member_card", "memberCardNo", "hyk_no"],
  mobiles: ["mobiles", "phone", "mobile", "sjhm"],
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

function fillParamsForCapability(
  paramsBlock: GuideParamsBlock | undefined,
  slots: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const names = [
    ...(paramsBlock?.required?.map((p) => p.name) ?? []),
    ...(paramsBlock?.optional?.map((p) => p.name) ?? [])
  ];
  for (const name of names) {
    const raw = slotValue(slots, name);
    if (raw === undefined) continue;
    out[name] = normalizeStringList(raw, 10);
  }
  return out;
}

function effectiveParamsBlock(
  guide: SkillGuideEntry,
  capability: GuideCapabilityMeta
): GuideParamsBlock | undefined {
  return capability.params ?? guide.params;
}

function scoreCapability(
  capability: GuideCapabilityMeta,
  userInput: string,
  slots: Record<string, unknown>
): number {
  const text = userInput.toLowerCase();
  const id = capability.id.toLowerCase();
  const desc = (capability.description ?? "").toLowerCase();
  let score = 0;
  if ((text.includes("卡号") || slots.member_card) && (id.includes("card") || desc.includes("卡号"))) score += 4;
  if ((text.includes("手机号") || slots.phone) && (id.includes("mobile") || desc.includes("手机号"))) score += 4;
  if ((text.includes("流水") || text.includes("明细")) && id.includes("ledger")) score += 5;
  if ((text.includes("生日") || text.includes("变更")) && id.includes("change_log")) score += 5;
  if ((text.includes("档案") || text.includes("资料")) && id.includes("profile")) score += 3;
  if (text.includes("积分") && id.includes("points")) score += 3;
  return score;
}

function pickBestCapability(
  guide: SkillGuideEntry,
  userInput: string,
  slots: Record<string, unknown>
): GuideCapabilityMeta | undefined {
  const caps = guide.capabilities ?? [];
  if (!caps.length) return undefined;
  let best: GuideCapabilityMeta | undefined;
  let bestScore = -1;
  for (const c of caps) {
    const s = scoreCapability(c, userInput, slots);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best ?? caps[0];
}

function resolveGuideMatch(
  state: OrchestratorState
): { guide: SkillGuideEntry; capability: GuideCapabilityMeta } | undefined {
  const ir = state.intentResult;
  if (!ir) return undefined;
  const baseSlots = (ir.resolvedSlots ?? {}) as Record<string, unknown>;
  const slots: Record<string, unknown> = {
    ...(state.guideResolvedParams ?? {}),
    ...baseSlots
  };
  const card = extractCardNoFromText(state.input.userInput);
  const phone = extractPhoneFromText(state.input.userInput);
  if (card && !slots.member_card) slots.member_card = card;
  if (phone && !slots.phone) slots.phone = phone;
  const key = ir.targetIntent?.trim() ?? "";
  if (key) {
    const hit = findGuideCapabilityByKey(key);
    if (hit?.capability) return { guide: hit.guide, capability: hit.capability };
    if (hit?.guide && hit.capability === undefined && hit.guide.capabilities?.length) {
      const cap = pickBestCapability(hit.guide, state.input.userInput, slots);
      if (cap) return { guide: hit.guide, capability: cap };
    }
  }

  const guides = listGuides().filter(
    (g) => g.domain === "data_query" && (!ir.dataQueryDomain || g.segment === ir.dataQueryDomain || ir.dataQueryDomain === "other")
  );
  for (const g of guides) {
    const cap = pickBestCapability(g, state.input.userInput, slots);
    if (cap) return { guide: g, capability: cap };
  }

  return undefined;
}

function shouldRunSql(capability: GuideCapabilityMeta): boolean {
  const sid = capability.execution?.skillId;
  return !sid || sid === "sql-query";
}

export function guideAgentNode(
  state: OrchestratorState
): Partial<OrchestratorState> {
  const t0 = Date.now();
  const ir = state.intentResult;
  if (
    !ir ||
    ir.primaryIntent !== "data_query" ||
    ir.needsClarification ||
    (ir.missingSlots?.length ?? 0) > 0
  ) {
    logDebugStep(
      "[Orchestrator]",
      "node guide_agent 跳过",
      "非 data_query 或意图层已澄清/缺槽",
      t0
    );
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedGuideId: undefined,
      selectedCapabilityId: undefined,
      guideResolvedParams: undefined
    };
  }

  const match = resolveGuideMatch(state);
  if (!match) {
    logDebugStep(
      "[Orchestrator]",
      "node guide_agent 无匹配 Guide",
      `targetIntent=${ir.targetIntent ?? ""}`,
      t0
    );
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedGuideId: undefined,
      selectedCapabilityId: undefined,
      guideResolvedParams: undefined
    };
  }

  const { guide, capability } = match;
  const paramsBlock = effectiveParamsBlock(guide, capability);
  const slots: Record<string, unknown> = {
    ...(state.guideResolvedParams ?? {}),
    ...((ir.resolvedSlots ?? {}) as Record<string, unknown>)
  };
  const card = extractCardNoFromText(state.input.userInput);
  const phone = extractPhoneFromText(state.input.userInput);
  if (card && !slots.member_card) slots.member_card = card;
  if (phone && !slots.phone) slots.phone = phone;
  let guideResolvedParams = fillParamsForCapability(paramsBlock, slots);
  const validation = validateGuideSlots(paramsBlock, guideResolvedParams);

  if (!validation.satisfied) {
    logDebugStep(
      "[Orchestrator]",
      "node guide_agent 缺 Guide 槽位",
      `missing=${validation.missing.join(",")}`,
      t0
    );
    return {
      guidePhase: "awaiting_slot",
      selectedGuideId: guide.id,
      selectedCapabilityId: capability.id,
      guideResolvedParams,
      guideMissingParams: validation.missing
    };
  }

  if (!shouldRunSql(capability)) {
    logDebugStep(
      "[Orchestrator]",
      "node guide_agent execution 非 sql-query",
      capability.execution?.skillId ?? "",
      t0
    );
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedGuideId: guide.id,
      selectedCapabilityId: capability.id,
      guideResolvedParams
    };
  }

  const rawSql = extractCapabilitySqlTemplate(guide.body, capability.id);
  if (!rawSql?.trim()) {
    logDebugStep(
      "[Orchestrator]",
      "node guide_agent 未找到 SQL 模板",
      `capability=${capability.id}`,
      t0
    );
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedGuideId: guide.id,
      selectedCapabilityId: capability.id,
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
    const { sql, params } = bindFirstInClause(rawSql, bindValues);
    const minC = capability.execution?.minConfidence;
    if (
      typeof minC === "number" &&
      Number.isFinite(minC) &&
      typeof ir.confidence === "number" &&
      ir.confidence < minC
    ) {
      logDebugStep(
        "[Orchestrator]",
        "node guide_agent 置信度低于 minConfidence，不注入 SQL",
        `confidence=${ir.confidence} min=${minC}`,
        t0
      );
      return {
        guidePhase: "skipped",
        guideMissingParams: [],
        selectedGuideId: guide.id,
        selectedCapabilityId: capability.id,
        guideResolvedParams
      };
    }

    logDebugStep(
      "[Orchestrator]",
      "node guide_agent 已绑定 SQL",
      `guide=${guide.id} capability=${capability.id}`,
      t0
    );

    return {
      guidePhase: "ready",
      guideMissingParams: [],
      selectedGuideId: guide.id,
      selectedCapabilityId: capability.id,
      guideResolvedParams,
      input: {
        ...state.input,
        sqlQuery: {
          sql,
          params,
          dbClientKey: "member",
          label: capability.id,
          purpose: capability.id
        }
      }
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logDebugStep(
      "[Orchestrator]",
      "node guide_agent 模板绑定失败",
      msg.slice(0, 200),
      t0
    );
    return {
      guidePhase: "skipped",
      guideMissingParams: [],
      selectedGuideId: guide.id,
      selectedCapabilityId: capability.id,
      guideResolvedParams
    };
  }
}
