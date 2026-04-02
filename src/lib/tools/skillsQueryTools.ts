import z from "zod";
import { getSkillDetailById, listSkillsByDomainSegment } from "../skills/catalog.js";
import type { SkillDomain, SkillSegment } from "../skills/type.js";

const listSkillsInputSchema = z.object({
  domain: z.string().describe("技能顶层域，如 core/data_query"),
  segment: z.string().describe("业务分段，如 member/ecommerce/other")
});

const getSkillDetailInputSchema = z.object({
  skillId: z.string().describe("技能 id，如 sql-query")
});

export const listSkillsByDomainSegmentTool = {
  name: "listSkillsByDomainSegment",
  description: "按 domain + segment 查询该分段下所有 skills 的简要信息",
  schema: listSkillsInputSchema
};

export async function runListSkillsByDomainSegmentTool(
  kwargs: Record<string, unknown>
): Promise<string> {
  const parsed = listSkillsInputSchema.parse(kwargs);
  const skills = listSkillsByDomainSegment(
    parsed.domain as SkillDomain,
    parsed.segment as SkillSegment
  );
  return JSON.stringify({ ok: true, count: skills.length, skills }, null, 2);
}

export const getSkillDetailByIdTool = {
  name: "getSkillDetailById",
  description: "根据 skillId 查看该 skill 的详情",
  schema: getSkillDetailInputSchema
};

export async function runGetSkillDetailByIdTool(
  kwargs: Record<string, unknown>
): Promise<string> {
  const parsed = getSkillDetailInputSchema.parse(kwargs);
  const detail = getSkillDetailById(parsed.skillId);
  if (!detail) {
    return JSON.stringify({ ok: false, error: `skill 不存在: ${parsed.skillId}` });
  }
  return JSON.stringify({ ok: true, skill: detail }, null, 2);
}
