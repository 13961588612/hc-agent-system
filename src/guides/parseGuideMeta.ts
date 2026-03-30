import type {
  GuideCapabilityMeta,
  GuideExecution,
  GuideParamDef,
  GuideParamsBlock
} from "./types.js";

function parseParamItem(x: unknown): GuideParamDef | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  return {
    name,
    type: typeof r.type === "string" ? r.type : undefined,
    description: typeof r.description === "string" ? r.description : undefined,
    examples: Array.isArray(r.examples) ? r.examples : undefined
  };
}

/** 从 YAML 对象解析 `params`；非法块返回 `undefined`（不抛错，兼容旧 Guide） */
export function parseParamsBlock(raw: unknown): GuideParamsBlock | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const required = Array.isArray(p.required)
    ? (p.required.map(parseParamItem).filter(Boolean) as GuideParamDef[])
    : [];
  const optional = Array.isArray(p.optional)
    ? (p.optional.map(parseParamItem).filter(Boolean) as GuideParamDef[])
    : [];
  if (required.length === 0 && optional.length === 0) return undefined;
  const out: GuideParamsBlock = {};
  if (required.length > 0) out.required = required;
  if (optional.length > 0) out.optional = optional;
  return out;
}

function parseCapabilityItem(raw: unknown): GuideCapabilityMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = typeof c.id === "string" ? c.id.trim() : "";
  if (!id) return null;
  const queryTemplateId =
    typeof c.queryTemplateId === "string" ? c.queryTemplateId.trim() : undefined;
  const description =
    typeof c.description === "string" ? c.description.trim() : undefined;
  const params = parseParamsBlock(c.params);
  const execution = parseExecutionBlock(c.execution);
  const out: GuideCapabilityMeta = { id };
  if (description) out.description = description;
  if (queryTemplateId) out.queryTemplateId = queryTemplateId;
  if (params) out.params = params;
  if (execution) out.execution = execution;
  return out;
}

/** 从 YAML 数组解析 `capabilities`；无效项跳过 */
export function parseCapabilitiesBlock(
  raw: unknown
): GuideCapabilityMeta[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const list = raw
    .map(parseCapabilityItem)
    .filter((x): x is GuideCapabilityMeta => x != null);
  return list.length > 0 ? list : undefined;
}

/** 从 YAML 对象解析 `execution`；缺 `skillId` 则视为未配置 */
export function parseExecutionBlock(raw: unknown): GuideExecution | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const skillId = typeof e.skillId === "string" ? e.skillId.trim() : "";
  if (!skillId) return undefined;
  return {
    skillId,
    sqlTemplateRef:
      typeof e.sqlTemplateRef === "string" ? e.sqlTemplateRef : undefined,
    confirmBeforeRun:
      typeof e.confirmBeforeRun === "boolean" ? e.confirmBeforeRun : undefined,
    minConfidence:
      typeof e.minConfidence === "number" && Number.isFinite(e.minConfidence)
        ? e.minConfidence
        : undefined
  };
}
