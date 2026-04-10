export type ModuleId = string;
export type DomainId = string;
export type Facet = string;

export type SystemModuleEntry = {
  id: string;
  title?: string;
  description?: string;
};

export type SystemDomainEntry = {
  id: string;
  title?: string;
  description?: string;
};

export type SystemConfigType = {
  version: number;
  modules: SystemModuleEntry[];
  domains: SystemDomainEntry[];
};

