import { z } from "zod/v3";
import { type SystemConfig } from "../config/systemConfig.js";

const FALLBACK_CONFIG: SystemConfig = {
  version: 1,
  intentions: [{ id: "other" }],
  domains: [{ id: "other" }]
};

function toEnumValues(values: string[], fallback: [string, ...string[]]): [string, ...string[]] {
  const cleaned = [...new Set(values.map((x) => x.trim()).filter(Boolean))];
  return cleaned.length > 0 ? (cleaned as [string, ...string[]]) : fallback;
}

export function buildSystemSchemas(config: SystemConfig) {
  const intentionIdValues = toEnumValues(
    (config.intentions ?? []).map((i) => i.id),
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

  const IntentionIdEnumSchema = z.enum(intentionIdValues);
  const DomainIdEnumSchema = z.enum(domainIdValues);
  const FacetEnumSchema = z.enum(facetValues);

  const IntentionEntrySchema = z.object({
    id: IntentionIdEnumSchema,
    title: z.string().optional(),
    description: z.string().optional()
  });

  const DomainEntrySchema = z.object({
    id: DomainIdEnumSchema,
    title: z.string().optional(),
    description: z.string().optional(),
    facets: z.array(FacetEnumSchema).optional()
  });
  const SystemConfigSchema = z.object({
    version: z.number().optional(),
    intentions: z.array(IntentionEntrySchema).optional(),
    domains: z.array(DomainEntrySchema).optional()
  });

  const IntentionIdDescription = config.intentions.map((i) => "["+i.id+":"+i.title+"]").join(", ");
  const DomainIdDescription = config.domains.map((d) => "["+d.id+":"+d.title+"]").join(", ");

  return {
    IntentionIdEnumSchema,
    DomainIdEnumSchema,
    FacetEnumSchema,
    IntentionEntrySchema,
    DomainEntrySchema,
    SystemConfigSchema,
    IntentionIdDescription,
    DomainIdDescription,
  };
}

let cached = buildSystemSchemas(FALLBACK_CONFIG);

export function refreshSystemSchemaCache(config: SystemConfig): void {
  cached = buildSystemSchemas(config);
}

export function getSystemSchemas() {
  return cached;
}

export const getIntentionIdSchema = () => cached.IntentionIdEnumSchema;
export const getDomainIdSchema = () => cached.DomainIdEnumSchema;
export const getFacetSchema = () => cached.FacetEnumSchema;
export const getIntentionEntrySchema = () => cached.IntentionEntrySchema;
export const getDomainEntrySchema = () => cached.DomainEntrySchema;
export const getSystemConfigSchema = () => cached.SystemConfigSchema;

export const getIntentionIdDescription = () => cached.IntentionIdDescription;
export const getDomainIdDescription = () => cached.DomainIdDescription;
