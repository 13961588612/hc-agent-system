import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * 域/分段在配置中的**分类维度**（可多选）：
 * - `business`：业务线，如 member、ecommerce、finance 等
 * - `skills`：技能，如 sql-query、invoke-skill 等
 * - `system-module`：系统模块，如 data_query、data_analysis、smart_form 等agent模块功能划分
 */
export const SYSTEM_FACETS = ["business", "skills", "system-module"] as const;
export type SystemFacet = (typeof SYSTEM_FACETS)[number];

export interface SystemDomainEntry {
  /** 唯一 id，可与 SkillDomain、业务域名对齐 */
  id: string;
  /** 展示用短标题 */
  title?: string;
  /** 说明，供文档与运维 */
  description?: string;
  /** 可同时属于多个分类维度 */
  facets: SystemFacet[];
}

export interface SystemSegmentEntry {
  /** 唯一 id，可与 SkillSegment、QueryDomain 对齐 */
  id: string;
  title?: string;
  description?: string;
  facets: SystemFacet[];
}

export interface SystemConfig {
  /** 配置格式版本，便于迁移 */
  version?: number;
  domains: SystemDomainEntry[];
  segments: SystemSegmentEntry[];
}

let singleton: SystemConfig | null = null;

function isSystemFacet(s: string): s is SystemFacet {
  return (SYSTEM_FACETS as readonly string[]).includes(s);
}

function normalizeFacets(raw: unknown, ctx: string): SystemFacet[] {
  if (!Array.isArray(raw)) {
    console.warn(`[SystemConfig] ${ctx} facets 缺失或非数组，已忽略`);
    return [];
  }
  const out: SystemFacet[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || !isSystemFacet(x)) {
      console.warn(`[SystemConfig] ${ctx} 非法 facet: ${String(x)}，已跳过`);
      continue;
    }
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

function normalizeDomain(raw: unknown, index: number): SystemDomainEntry | null {
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
    facets: normalizeFacets(o.facets, `domains[${id}]`)
  };
}

function normalizeSegment(raw: unknown, index: number): SystemSegmentEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) {
    console.warn(`[SystemConfig] segments[${index}] 缺少 id，已跳过`);
    return null;
  }
  return {
    id,
    title: typeof o.title === "string" ? o.title : undefined,
    description: typeof o.description === "string" ? o.description : undefined,
    facets: normalizeFacets(o.facets, `segments[${id}]`)
  };
}

/**
 * 未调用 {@link initSystemConfig} 注入、或加载失败/为空时的占位配置（无内置业务域/分段）。
 * 已冻结，请勿就地修改；问数域枚举见 {@link listQuerySegmentIds}（空 segments 时仍为 `["other"]`）。
 */
const EMPTY_SYSTEM_CONFIG = Object.freeze({
  domains: Object.freeze([] as SystemDomainEntry[]),
  segments: Object.freeze([] as SystemSegmentEntry[])
}) as unknown as SystemConfig;

function parseRoot(parsed: unknown): SystemConfig | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const version =
    typeof root.version === "number" && Number.isFinite(root.version)
      ? root.version
      : undefined;

  const domainsRaw = root.domains;
  const segmentsRaw = root.segments;

  const domains: SystemDomainEntry[] = [];
  if (Array.isArray(domainsRaw)) {
    domainsRaw.forEach((row, i) => {
      const d = normalizeDomain(row, i);
      if (d) domains.push(d);
    });
  }

  const segments: SystemSegmentEntry[] = [];
  if (Array.isArray(segmentsRaw)) {
    segmentsRaw.forEach((row, i) => {
      const s = normalizeSegment(row, i);
      if (s) segments.push(s);
    });
  }

  return { version, domains, segments };
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

/** 由 {@link initSystemConfig} 在启动时注入；未初始化或加载失败时为冻结的空壳（domains/segments 皆空） */
export function getSystemConfig(): SystemConfig {
  return singleton ?? EMPTY_SYSTEM_CONFIG;
}

/**
 * 启动时调用一次：`loaded` 含有效 domains 或 segments 时写入单例；否则单例置空（`getSystemConfig` 返回空壳）。
 */
export function initSystemConfig(loaded: SystemConfig | null): void {
  if (loaded && (loaded.domains.length > 0 || loaded.segments.length > 0)) {
    singleton = loaded;
    return;
  }
  if (loaded && loaded.domains.length === 0 && loaded.segments.length === 0) {
    console.warn(
      "[SystemConfig] 文件存在但 domains/segments 均为空，请检查 system.yaml；当前使用空配置"
    );
  }
  singleton = null;
}

/** 测试或热替换用 */
export function resetSystemConfigForTests(): void {
  singleton = null;
}

export function getDomainEntry(id: string,config: SystemConfig = getSystemConfig()): SystemDomainEntry | undefined {
  if(!config) return undefined;
  return config.domains.find((d) => d.id === id);
}

export function getSegmentEntry(id: string,config: SystemConfig = getSystemConfig()): SystemSegmentEntry | undefined {
  if(!config) return undefined;
  return config.segments.find((s) => s.id === id);
}

export function listDomainByFacets(facets: SystemFacet[],config: SystemConfig = getSystemConfig()): SystemDomainEntry[] {
  if(!config) return [];
  return config.domains.filter((d) => facets.every((f) => d.facets.includes(f)));
}

export function listSegmentByFacets(facets: SystemFacet[],config: SystemConfig = getSystemConfig()): SystemSegmentEntry[] {
  if(!config) return [];
  return config.segments.filter((s) => facets.every((f) => s.facets.includes(f)));
}

export function listSystemModuleDomains(config: SystemConfig = getSystemConfig()): SystemDomainEntry[] {
  if(!config) return [];
  return listDomainByFacets(["system-module"],config);
}

export function listSkillsDomains(config: SystemConfig = getSystemConfig()): SystemDomainEntry[] {
  if(!config) return [];
  return listDomainByFacets(["skills"],config);
}

export function listBusinessSegments(config: SystemConfig = getSystemConfig()): SystemSegmentEntry[] {
  if(!config) return [];
  return listSegmentByFacets(["business"],config);
}

export function listSkillsSegments(config: SystemConfig = getSystemConfig()): SystemSegmentEntry[] {
  if(!config) return [];
  return listSegmentByFacets(["skills"],config);
}

export function listBusinessSegmentIds(config: SystemConfig = getSystemConfig()): string[] {
  if(!config) return [];
  return listSegmentByFacets(["business"],config).map((s) => s.id);
}

/** 兼容旧命名：问数域 segment ids（等价于 business segments） */
export function listQuerySegmentIds(config: SystemConfig = getSystemConfig()): string[] {
  return listBusinessSegmentIds(config);
}

/**
 * 供 Zod `z.enum` 使用（至少一个元素）；与 {@link listBusinessSegmentIds} 同源。
 */
export function businessSegmentZodEnumValues(
  config: SystemConfig = getSystemConfig()
): [string, ...string[]] {
  const ids = listBusinessSegmentIds(config);
  return ids as [string, ...string[]];
}

