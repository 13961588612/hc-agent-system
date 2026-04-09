import { z } from "zod/v3";
import { getSystemConfig } from "../config/systemConfig.js";

function toEnumValues(values: string[], fallback: [string, ...string[]]): [string, ...string[]] {
  const cleaned = [...new Set(values.map((x) => x.trim()).filter(Boolean))];
  return cleaned.length > 0 ? (cleaned as [string, ...string[]]) : fallback;
}

const systemConfig = getSystemConfig();

export const ModuleIdSchema = z.enum(
  toEnumValues(
    (await systemConfig).modules.map((m) => m.id),
    ["empty"]
  )
);

/** 业务域 id（如 member / ecommerce / finance） */
export const DomainIdSchema = z.enum(
  toEnumValues(
    (await systemConfig).domains.map((d) => d.id),
    ["empty"]
  )
);

/** domain 可用 facet（来自 domains[].facets 去重汇总） */
export const FacetSchema = z.enum(
  toEnumValues(
    (await systemConfig).domains.flatMap((d) => d.facets ?? []),
    ["empty"]
  )
);

/** system.yaml 的 module 条目 */
export const SystemModuleEntrySchema = z.object({
  id: ModuleIdSchema,
  title: z.string().optional(),
  description: z.string().optional()
});

/** system.yaml 的 domain 条目 */
export const SystemDomainEntrySchema = z.object({
  id: DomainIdSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  facets: z.array(FacetSchema).optional()
});

/** system 配置结构 */
export const SystemConfigSchema = z.object({
  version: z.number().optional(),
  module: z.array(SystemModuleEntrySchema).optional(),
  domains: z.array(SystemDomainEntrySchema).optional()
});

/** 兼容旧名，逐步收敛到 ModuleIdSchema */
export const SystemModuleIdSchema = ModuleIdSchema;
