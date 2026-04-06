import z from "zod";
import { getSkillDetailById, listSkillsByDomainSegment } from "../skills/catalog.js";

const listSkillsInputSchema = z.object({
  domainId: z.string().describe("技能顶层域，如 data_analysis/data_query/common"),
  segmentId: z.string().describe("业务分段，如 member/ecommerce/finance/other")
});

const invokeSkillInputSchema = z.object({
  skillId: z.string().describe("技能 id，如 guide-member-profile ")
});

export const listSkillsByDomainSegmentTool = {
  name: "list_skills_by_domain_segment",
  description: "按 domain + segment 查询该分段下所有 skills 的简要信息",
  schema: listSkillsInputSchema
};

export async function runListSkillsByDomainSegmentTool(
  domainId: string,
  segmentId: string
): Promise<string> {
  const skills = listSkillsByDomainSegment(domainId, segmentId);
  return JSON.stringify({ ok: true, count: skills.length, skills }, null, 2);
}

export const invokeSkillTool = {
  name: "invoke_skill",
  description: "根据 skillId 调用该 skill",
  schema: invokeSkillInputSchema
};

export async function runInvokeSkillTool(
  skillId: string
): Promise<string> {
  const detail = getSkillDetailById(skillId);
  if (!detail) {
    return JSON.stringify({ ok: false, error: `skill 不存在: ${skillId}` });
  }
  return JSON.stringify({ ok: true, skill: detail }, null, 2);
}
