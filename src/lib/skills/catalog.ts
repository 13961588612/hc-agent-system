import type { AnySkillMeta, SkillDomain, SkillSegment } from "./type.js";

/**
 * 轻量技能目录：
 * - 先用于 tool 查询（按 domain+segment / 按 id）。
 * - 后续可替换为动态发现与注册中心。
 */
const SKILL_CATALOG: AnySkillMeta[] = [
  {
    id: "sql-query",
    name: "SQL 查询",
    description: "执行参数化 SQL 查询并返回行集。",
    domain: "core",
    segment: "other",
    capabilities: ["sql", "database", "query"],
    exampleQueries: ["查最近订单", "查询会员积分明细"]
  }
];

export interface SkillBriefInfo {
  id: string;
  name: string;
  description: string;
  domain?: SkillDomain;
  segment?: SkillSegment;
}

export function listSkillsByDomainSegment(
  domain: SkillDomain | string,
  segment: SkillSegment | string
): SkillBriefInfo[] {
  return SKILL_CATALOG.filter(
    (s) => (s.domain ?? "") === domain && (s.segment ?? "") === segment
  ).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    domain: s.domain,
    segment: s.segment
  }));
}

export function getSkillDetailById(skillId: string): AnySkillMeta | undefined {
  return SKILL_CATALOG.find((s) => s.id === skillId);
}
