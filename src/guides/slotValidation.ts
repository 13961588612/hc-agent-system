import type { GuideParamsBlock } from "./types.js";

/** Guide 槽位校验结果（与 `Guide.params.required/optional` 对齐） */
export interface SlotValidationResult {
  /** 全部必填已填且无不合法项时为 true */
  satisfied: boolean;
  /** `required` 中在 `resolved` 里缺失或视为空的参数名 */
  missing: string[];
  /**
   * 已提供但类型/格式不符合定义（如应为数组却为标量）；当前实现可预留，由后续类型门填充。
   */
  invalid: Array<{ name: string; reason: string }>;
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string" && !v.trim()) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/**
 * 校验 `resolved` 是否满足 `params` 中 required；optional 不强制。
 * 未配置 `params` 时视为已满足。
 */
export function validateGuideSlots(
  paramsBlock: GuideParamsBlock | undefined,
  resolved: Record<string, unknown>
): SlotValidationResult {
  const missing: string[] = [];
  const invalid: Array<{ name: string; reason: string }> = [];

  if (!paramsBlock) {
    return { satisfied: true, missing, invalid };
  }

  for (const p of paramsBlock.required ?? []) {
    const name = p.name;
    const v = resolved[name];
    if (isEmptyValue(v)) missing.push(name);
  }

  return {
    satisfied: missing.length === 0 && invalid.length === 0,
    missing,
    invalid
  };
}
