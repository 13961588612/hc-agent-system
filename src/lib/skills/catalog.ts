import type { SkillGuideEntry } from "../guides/types.js";
import { getGuide, listGuides } from "../guides/guideRegistry.js";
import { getDomainEntry, getSystemConfig, getSegmentEntry } from "../../config/systemConfig.js";
import type {
  AnySkillMeta,
  SkillBriefInfo,
  SkillCapabilityBrief,
  SkillOrGuideDetail
} from "./type.js";

/**
 * 轻量技能目录（可执行技能）：
 * 当前包含 core skills,guides , playbooks
 * - 先用于 tool 查询（按 domain+segment / 按 id）。
 * - 后续可替换为动态发现与注册中心。
 */
function buildSkillCatalog(): AnySkillMeta[] {
  const guides = listGuides();
  //const playbooks = listPlaybooks();

  const skills: AnySkillMeta[] = [];
  guides.forEach(g => {
    skills.push(generateSkillByGuide(g));
  });
  return [...skills];
}

/** 从 Guide 头部/槽位元数据构造入参说明（供 disclose、invoke 与规划引用） */
function buildInputSchemaFromGuide(guide: SkillGuideEntry): Record<string, unknown> | undefined {
  const hasParams =
    (guide.params?.required?.length ?? 0) > 0 || (guide.params?.optional?.length ?? 0) > 0;
  const hasInputBrief = (guide.inputBrief?.required?.length ?? 0) > 0;
  if (!hasParams && !hasInputBrief) return undefined;
  const out: Record<string, unknown> = {
    kind: "guide",
    summary:
      "输入约定：inputBrief 为规划用摘要；params 为槽位（required/optional），执行前需解析齐全 required。"
  };
  if (hasInputBrief && guide.inputBrief) {
    out.inputBrief = guide.inputBrief as unknown as Record<string, unknown>;
  }
  if (hasParams && guide.params) {
    out.params = {
      required: guide.params.required ?? [],
      optional: guide.params.optional ?? []
    };
  }
  return out;
}

/** 从 Guide 头部输出摘要构造出参说明（字段名、类型、是否可空等） */
function buildOutputSchemaFromGuide(guide: SkillGuideEntry): Record<string, unknown> | undefined {
  const ob = guide.outputBrief;
  if (!ob) return undefined;
  const hasFields = (ob.fields?.length ?? 0) > 0;
  if (!hasFields && !ob.resultType?.trim() && !ob.resultPath?.trim()) return undefined;
  return {
    kind: "guide",
    summary: "输出约定：典型结果类型与字段列表见下方；实际以 sql-query 返回行为准。",
    resultType: ob.resultType,
    resultPath: ob.resultPath,
    fields: ob.fields ?? []
  };
}

const IO_SUMMARY_MAX_LEN = 480;

function truncateIoSummary(s: string): string {
  if (s.length <= IO_SUMMARY_MAX_LEN) return s;
  return `${s.slice(0, IO_SUMMARY_MAX_LEN - 1)}…`;
}

/** 列表用入参一句话摘要 */
function buildInputSummaryFromGuide(guide: SkillGuideEntry): string | undefined {
  const seen = new Set<string>();
  const requiredLabels: string[] = [];
  for (const p of guide.inputBrief?.required ?? []) {
    const label = (p.caption?.trim() || p.name?.trim() || "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    requiredLabels.push(label);
  }
  for (const p of guide.params?.required ?? []) {
    const name = p.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const desc = p.description?.trim();
    requiredLabels.push(desc && desc.length <= 40 ? `${name}（${desc}）` : name);
  }
  const optionalNames = (guide.params?.optional ?? [])
    .map((p) => p.name?.trim())
    .filter((n): n is string => Boolean(n))
    .filter((n) => !seen.has(n));
  const parts: string[] = [];
  if (requiredLabels.length > 0) parts.push(`必填：${requiredLabels.join("、")}`);
  if (optionalNames.length > 0) parts.push(`可选：${optionalNames.join("、")}`);
  if (parts.length === 0) return undefined;
  return truncateIoSummary(parts.join("；"));
}

/** 列表用出参一句话摘要 */
function buildOutputSummaryFromGuide(guide: SkillGuideEntry): string | undefined {
  const ob = guide.outputBrief;
  if (!ob) return undefined;
  const parts: string[] = [];
  if (ob.resultType?.trim()) parts.push(`结果类型：${ob.resultType.trim()}`);
  if (ob.resultPath?.trim()) parts.push(`路径：${ob.resultPath.trim()}`);
  const fields = ob.fields ?? [];
  if (fields.length > 0) {
    const maxFields = 16;
    const labels = fields.slice(0, maxFields).map((f) => (f.caption?.trim() || f.name).trim());
    const tail = fields.length > maxFields ? ` 等共 ${fields.length} 项` : "";
    parts.push(`字段：${labels.join("、")}${tail}`);
  }
  if (parts.length === 0) return undefined;
  return truncateIoSummary(parts.join("；"));
}

function ioSummariesForMeta(s: AnySkillMeta): {
  inputSummary?: string;
  outputSummary?: string;
} {
  if (s.kind !== "guide") return {};
  const g = s.skill;
  if (!g || typeof g !== "object" || !("id" in g)) return {};
  const guide = g as SkillGuideEntry;
  const inputSummary = buildInputSummaryFromGuide(guide);
  const outputSummary = buildOutputSummaryFromGuide(guide);
  return {
    ...(inputSummary ? { inputSummary } : {}),
    ...(outputSummary ? { outputSummary } : {})
  };
}

function generateSkillByGuide(guide: SkillGuideEntry): AnySkillMeta {
  const capabilities: SkillCapabilityBrief[] = [
    { id: guide.id, ...(guide.description ? { description: guide.description } : {}) }
  ];
  const inputSchema = buildInputSchemaFromGuide(guide);
  const outputSchema = buildOutputSchemaFromGuide(guide);
  // inputSchema：Guide 头部 inputBrief + frontmatter params；outputSchema：outputBrief
  return {
    id: guide.id,
    name: guide.title,
    description: guide.description ?? "",
    domainId: guide.domain,
    segmentId: guide.segment,
    kind: "guide" as const,
    capabilities: capabilities,
    ...(inputSchema ? { inputSchema } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    skill: guide
  } as AnySkillMeta;
}

let SKILL_CATALOG: AnySkillMeta[] | undefined = undefined;

export function getSkillCatalog(): AnySkillMeta[] {
  if (!SKILL_CATALOG) {
    SKILL_CATALOG = buildSkillCatalog();
  }
  return SKILL_CATALOG;
}

export function listSkillsByDomainSegment(
  domainId: string,
  segmentId: string
): SkillBriefInfo[] {
  const normalizeCapabilities = (
    capabilities: AnySkillMeta["capabilities"]
  ): SkillCapabilityBrief[] | undefined => {
    if (!capabilities || capabilities.length === 0) return undefined;
    return capabilities as SkillCapabilityBrief[];
  };

  const skills = getSkillCatalog().filter(
    (s) => (s.domainId ?? "") === domainId && (s.segmentId ?? "") === segmentId
  ).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    domainId: s.domainId,
    segmentId: s.segmentId,
    kind: s.kind,
    capabilities: normalizeCapabilities(s.capabilities),
    ...ioSummariesForMeta(s)
  }));

  return [...skills];
}

export function getSkillDetailById(skillId: string): SkillOrGuideDetail | undefined {
  const skill = getSkillCatalog().find((s) => s.id === skillId);
  if (skill) {
    return skill;
  }
  
  return undefined;
}
