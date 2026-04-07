import type {
  GuideExecution,
  GuideInputBrief,
  GuideOutputBrief,
  GuideOutputFieldBrief,
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

export function parseInputBrief(raw: unknown): GuideInputBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const required = Array.isArray(r.required)
    ? r.required
        .map((x) => {
          if (!x || typeof x !== "object") return null;
          const o = x as Record<string, unknown>;
          const name = typeof o.name === "string" ? o.name.trim() : "";
          if (!name) return null;
          return {
            name,
            caption: typeof o.caption === "string" ? o.caption : undefined,
            type: typeof o.type === "string" ? o.type : undefined,
            maxItems:
              typeof o.maxItems === "number" && Number.isFinite(o.maxItems)
                ? o.maxItems
                : undefined,
            description:
              typeof o.description === "string" ? o.description : undefined
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
    : [];
  if (required.length === 0) return undefined;
  return { required };
}

function parseOutputFieldBrief(raw: unknown): GuideOutputFieldBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  return {
    name,
    caption: typeof r.caption === "string" ? r.caption : undefined,
    type: typeof r.type === "string" ? r.type : undefined,
    nullable: typeof r.nullable === "boolean" ? r.nullable : undefined
  };
}

export function parseOutputBrief(raw: unknown): GuideOutputBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const resultType =
    typeof r.resultType === "string" ? r.resultType.trim() : undefined;
  const resultPath =
    typeof r.resultPath === "string" ? r.resultPath.trim() : undefined;
  const fields = Array.isArray(r.fields)
    ? r.fields
        .map(parseOutputFieldBrief)
        .filter((x): x is GuideOutputFieldBrief => x != null)
    : [];
  if (!resultType && !resultPath && fields.length === 0) return undefined;
  return {
    ...(resultType ? { resultType } : {}),
    ...(resultPath ? { resultPath } : {}),
    ...(fields.length > 0 ? { fields } : {})
  };
}
