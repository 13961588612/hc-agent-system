import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface IntentionEntry {
  id: string;
  /** 展示用短标题 */
  title?: string;
  /** 说明，供文档与运维 */
  description?: string;
}

export interface DomainEntry {
  /** 唯一 id，可与 SkillSegment、QueryDomain 对齐 */
  id: string;
  title?: string;
  description?: string;
  /** domain 支持 facets（如 business/skills） */
  facets?: string[];
}

export interface SystemConfig {
  /** 配置格式版本，便于迁移 */
  version?: number;
  intentions: IntentionEntry[];
  domains: DomainEntry[];
}

let singleton: SystemConfig;
let initialized: boolean = false;

function normalizeIntention(
  raw: unknown,
  index: number
): IntentionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) {
    console.warn(`[SystemConfig] intentions[${index}] 缺少 id，已跳过`);
    return null;
  }
  return {
    id,
    title: typeof o.title === "string" ? o.title : undefined,
    description: typeof o.description === "string" ? o.description : undefined
  };
}

function normalizeDomain(raw: unknown, index: number): DomainEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) {
    console.warn(`[SystemConfig] domains[${index}] 缺少 id，已跳过`);
    return null;
  }
  return {
    id,
    title: typeof o.title === "string" ? o.title : undefined,
    description: typeof o.description === "string" ? o.description : undefined,
    facets: Array.isArray(o.facets)
      ? o.facets.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : undefined
  };
}

/**
 * 未调用 {@link initSystemConfig} 注入、或加载失败/为空时的占位配置（无内置业务域/分段）。
 * 已冻结，请勿就地修改；问数域枚举见 {@link listQuerySegmentIds}（空 domains 时仍为 `["other"]`）。
 */
const EMPTY_SYSTEM_CONFIG = Object.freeze({
  intentions: Object.freeze([] as IntentionEntry[]),
  domains: Object.freeze([] as DomainEntry[])
}) as unknown as SystemConfig;

function parseRoot(parsed: unknown): SystemConfig | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const version =
    typeof root.version === "number" && Number.isFinite(root.version)
      ? root.version
      : undefined;

  const intentionRaw = root.intention;
  const intentionsRaw = Array.isArray(intentionRaw) ? intentionRaw : undefined;
  const domainsRaw = Array.isArray(root.domains) ? root.domains : root.segments;

  const intentions: IntentionEntry[] = [];
  if (Array.isArray(intentionsRaw)) {
    intentionsRaw.forEach((row, i) => {
      const d = normalizeIntention(row, i);
      if (d) intentions.push(d);
    });
  }

  const domains: DomainEntry[] = [];
  if (Array.isArray(domainsRaw)) {
    domainsRaw.forEach((row, i) => {
      const d = normalizeDomain(row, i);
      if (d) domains.push(d);
    });
  }

  return {
    version,
    intentions,
    domains
  };
}

/**
 * 读取 `SYSTEM_CONFIG` 指向的文件，或默认 `<cwd>/config/system.yaml`。
 * 文件不存在或解析失败时返回 `null`（调用方应对 {@link initSystemConfig} 传入 `null`，由 {@link getSystemConfig} 得到空壳配置）。
 */
export async function loadSystemConfigFromFile(): Promise<SystemConfig | null> {
  const path =
    process.env.SYSTEM_CONFIG?.trim() || join(process.cwd(), "config", "system.yaml");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    console.warn("[SystemConfig] YAML 解析失败:", path);
    return null;
  }
  const config = parseRoot(parsed);
  if (!config) {
    console.warn("[SystemConfig] 根对象无效:", path);
    return null;
  }
  return config;
}

function initSystemConfig(systemConfig: SystemConfig): void {
  singleton = systemConfig;
  initialized = true;
}

/** 由 {@link initSystemConfig} 在启动时注入；未初始化或加载失败时为冻结的空壳（intentions/domains 皆空） */
export async function getSystemConfig(): Promise<SystemConfig> {
  if(!initialized) {
    const config = await loadSystemConfigFromFile();
    if(config) {
      singleton = config;
    }else{
      singleton = EMPTY_SYSTEM_CONFIG;
    }
    initialized = true;
  }
  return singleton;
}

/** 测试或热替换用 */
export function resetSystemConfigForTests(): void {
  singleton = EMPTY_SYSTEM_CONFIG;
  initialized = false;
}

export async function getIntentionEntry(id: string): Promise<IntentionEntry | null> {
  const config = await getSystemConfig();
  return config.intentions.find((i) => i.id === id) ?? null;
}

export async function getDomainEntry(id: string): Promise<DomainEntry | null> {
  const config = await getSystemConfig();
  return config.domains.find((d) => d.id === id) ?? null;
}

export async function listIntentions(): Promise<IntentionEntry[]> {
  const config = await getSystemConfig();
  return config.intentions;
}

export async function listDomains(): Promise<DomainEntry[]> {
  const config = await getSystemConfig();
  return config.domains;
}

export async function listBusinessDomains(): Promise<DomainEntry[]> {
  const config = await getSystemConfig();
  if(!config) return [];
  return config.domains.filter((d) =>
    Array.isArray(d.facets) && d.facets.length > 0 && d.facets.includes("business")
  );
}

