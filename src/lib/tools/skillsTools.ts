import z from "zod";
import { getSkillDetailById, listSkillsByDomainSegment } from "../skills/catalog.js";
import type { SkillOrGuideDetail } from "../skills/type.js";

const listSkillsInputSchema = z.object({
  domainId: z.string().describe("技能顶层域，不支持通过分隔符一次传入多个值"),
  segmentId: z.string().describe("业务分段，不支持通过分隔符一次传入多个值")
});

const invokeSkillInputSchema = z.object({
  skillId: z.string().describe("技能 id，如 member-profile-by-user-id ")
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
  const skills = listSkillsByDomainSegment(domainId, segmentId).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    description: s.description,
    capabilities: s.capabilities,
    inputSummary: s.inputSummary,
    outputSummary: s.outputSummary
  }));
  return JSON.stringify({ ok: true, count: skills.length, skills });
}

export const invokeSkillTool = {
  name: "invoke_skill",
  description: "根据 skillId 调用该 skill",
  schema: invokeSkillInputSchema
};

function truncateGuideBodyInDetail(
  detail: SkillOrGuideDetail,
  maxChars: number
): SkillOrGuideDetail {
  if (!detail || typeof detail !== "object") return detail;
  const d = detail as Record<string, unknown>;
  const skill = d["skill"];
  if (!skill || typeof skill !== "object") return detail;
  const s = skill as Record<string, unknown>;
  const body = s["body"];
  if (typeof body !== "string" || body.length <= maxChars) return detail;
  return {
    ...d,
    skill: {
      ...s,
      body: `${body.slice(0, maxChars)}\n\n...[正文已截断：${body.length}→${maxChars} 字；规划请用 inputSummary/outputSummary、inputBrief、params、outputBrief；完整正文在执行阶段拉取]`
    }
  } as SkillOrGuideDetail;
}

/**
 * @param options.maxGuideBodyChars 仅截断嵌套 `skill.body`（Guide），不影响 dataQuery 等不传该参数时的全文
 */
export async function runInvokeSkillTool(
  skillId: string,
  options?: { maxGuideBodyChars?: number }
): Promise<string> {
  const detail = getSkillDetailById(skillId);
  if (!detail) {
    return JSON.stringify({ ok: false, error: `skill 不存在: ${skillId}` });
  }
  const max = options?.maxGuideBodyChars;
  const payload =
    max !== undefined && max > 0
      ? truncateGuideBodyInDetail(detail, max)
      : detail;
  return JSON.stringify({ ok: true, skill: payload }, null, 2);
}
