import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * 域/分段在配置中的**分类维度**（可多选）：
 * - `business`：意图识别、任务划分、业务路由
 * - `common`：核心通用能力，如 sql-query、invoke-skill 等底层能力
 * - `functional`：功能域，如 sql-query、invoke-skill 等底层能力
 */
export const SYSTEM_FACETS = ["business", "common", "functional"] as const;
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

/** 内置默认，与 `config/system.example.yaml` 语义对齐；文件不存在时使用 */
export function getDefaultSystemConfig(): SystemConfig {
  return {
    version: 1,
    domains: [
      { id: "data_query", title: "数据查询", facets: ["functional"] },
      { id: "common", title: "核心通用能力", facets: ["common"] }
    ],
    segments: [
      { id: "other", title: "其他", facets: ["business"] }
    ]
  };
}

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
 * 文件不存在或解析失败时返回 `null`（调用方可用 {@link getDefaultSystemConfig}）。
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

/** 由 {@link initSystemConfig} 在启动时注入；未初始化时返回内置默认 */
export function getSystemConfig(): SystemConfig {
  return singleton ?? getDefaultSystemConfig();
}

/** 启动时调用一次：优先文件，缺省用内置默认 */
export function initSystemConfig(loaded: SystemConfig | null): void {
  if (loaded && (loaded.domains.length > 0 || loaded.segments.length > 0)) {
    singleton = loaded;
    return;
  }
  if (loaded && loaded.domains.length === 0 && loaded.segments.length === 0) {
    console.warn("[SystemConfig] 文件存在但 domains/segments 均为空，回退内置默认");
    singleton = getDefaultSystemConfig();
    return;
  }
  singleton = getDefaultSystemConfig();
}

/** 测试或热替换用 */
export function resetSystemConfigForTests(): void {
  singleton = null;
}

export function listDomainIdsByFacet(
  config: SystemConfig,
  facet: SystemFacet
): string[] {
  return config.domains.filter((d) => d.facets.includes(facet)).map((d) => d.id);
}

export function listSegmentIdsByFacet(
  config: SystemConfig,
  facet: SystemFacet
): string[] {
  return config.segments.filter((s) => s.facets.includes(facet)).map((s) => s.id);
}

export function getDomainEntry(
  config: SystemConfig,
  id: string
): SystemDomainEntry | undefined {
  return config.domains.find((d) => d.id === id);
}

export function getSegmentEntry(
  config: SystemConfig,
  id: string
): SystemSegmentEntry | undefined {
  return config.segments.find((s) => s.id === id);
}
