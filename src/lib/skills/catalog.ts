import type { SkillGuideEntry } from "../guides/types.js";
import { getGuide, listGuides } from "../guides/guideRegistry.js";
import { getDomainEntry, getSystemConfig, getSegmentEntry } from "../../config/systemConfig.js";
import type { AnySkillMeta, SkillCapabilityBrief, skillType } from "./type.js";

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

function generateSkillByGuide(guide: SkillGuideEntry): AnySkillMeta {
  const capabilities: SkillCapabilityBrief[] = [
    { id: guide.id, ...(guide.description ? { description: guide.description } : {}) }
  ];
  return {
    id: guide.id,
    name: guide.title,
    description: guide.description ?? "",
    domainId: guide.domain,
    segmentId: guide.segment,
    kind: "guide" as const,
    capabilities: capabilities,
    skill: guide,
  } as AnySkillMeta;
}

let SKILL_CATALOG: AnySkillMeta[] | undefined = undefined;

export function getSkillCatalog(): AnySkillMeta[] {
  if (!SKILL_CATALOG) {
    SKILL_CATALOG = buildSkillCatalog();
  }
  return SKILL_CATALOG;
}

export interface SkillBriefInfo {
  id: string;
  name: string;
  description: string;
  /** 对齐系统配置中的域 id，如 data_query/core/member */
  domainId?: string;
  /** 对齐系统配置中的分段 id，如 member/ecommerce/other */
  segmentId?: string;
  /** 区分可执行技能 vs Guide/Playbook */
  kind: skillType;

  capabilities?: SkillCapabilityBrief[];
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
  }));

  return [...skills];
}

export type SkillOrGuideDetail =  AnySkillMeta | SkillGuideEntry | unknown;

export function getSkillDetailById(skillId: string): SkillOrGuideDetail | undefined {
  const skill = getSkillCatalog().find((s) => s.id === skillId);
  if (skill) {
    return skill;
  }
  
  return undefined;
}
