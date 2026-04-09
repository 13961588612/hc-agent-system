import { z } from "zod/v3";
import {
  DomainIdSchema,
  FacetSchema,
  ModuleIdSchema,
  SystemConfigSchema,
  SystemDomainEntrySchema,
  SystemModuleEntrySchema
} from "./SystemSchema.js";

export type ModuleId = z.infer<typeof ModuleIdSchema>;
export type DomainId = z.infer<typeof DomainIdSchema>;
export type Facet = z.infer<typeof FacetSchema>;

export type SystemModuleEntry = z.infer<typeof SystemModuleEntrySchema>;
export type SystemDomainEntry = z.infer<typeof SystemDomainEntrySchema>;
export type SystemConfigContract = z.infer<typeof SystemConfigSchema>;
