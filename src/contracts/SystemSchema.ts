import { z } from "zod/v3";
import { type SystemConfig } from "../config/systemConfig.js";

const FALLBACK_CONFIG: SystemConfig = {
  version: 1,
  modules: [{ id: "other" }],
  domains: [{ id: "other" }]
};

function toEnumValues(values: string[], fallback: [string, ...string[]]): [string, ...string[]] {
  const cleaned = [...new Set(values.map((x) => x.trim()).filter(Boolean))];
  return cleaned.length > 0 ? (cleaned as [string, ...string[]]) : fallback;
}

export function buildSystemSchemas(config: SystemConfig) {
  const moduleIdValues = toEnumValues(
    (config.modules ?? []).map((m) => m.id),
    ["query"]
  );
  const domainIdValues = toEnumValues(
    (config.domains ?? []).map((d) => d.id),
    ["other"]
  );
  const facetValues = toEnumValues(
    (config.domains ?? []).flatMap((d) => d.facets ?? []),
    ["business", "skills"]
  );

  const ModuleIdSchema = z.enum(moduleIdValues);
  const DomainIdSchema = z.enum(domainIdValues);
  const FacetSchema = z.enum(facetValues);
  const ModuleEntrySchema = z.object({
    id: ModuleIdSchema,
    title: z.string().optional(),
    description: z.string().optional()
  });
  const DomainEntrySchema = z.object({
    id: DomainIdSchema,
    title: z.string().optional(),
    description: z.string().optional(),
    facets: z.array(FacetSchema).optional()
  });
  const SystemConfigSchema = z.object({
    version: z.number().optional(),
    module: z.array(ModuleEntrySchema).optional(),
    domains: z.array(DomainEntrySchema).optional()
  });

  return {
    ModuleIdSchema,
    DomainIdSchema,
    FacetSchema,
    ModuleEntrySchema,
    DomainEntrySchema,
    SystemConfigSchema
  };
}

let cached = buildSystemSchemas(FALLBACK_CONFIG);

export function refreshSystemSchemaCache(config: SystemConfig): void {
  cached = buildSystemSchemas(config);
}

export function getSystemSchemas() {
  return cached;
}

export const getModuleIdSchema = () => cached.ModuleIdSchema;
export const getDomainIdSchema = () => cached.DomainIdSchema;
export const getFacetSchema = () => cached.FacetSchema;
export const getModuleEntrySchema = () => cached.ModuleEntrySchema;
export const getDomainEntrySchema = () => cached.DomainEntrySchema;
export const getSystemConfigSchema = () => cached.SystemConfigSchema;

