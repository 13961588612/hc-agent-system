import z from "zod";
import { getSkillDetailById, listSkills } from "../skills/catalog.js";
import { SkillDetail } from "../skills/type.js";

const listSkillsInputSchema = z.object({
  moduleId: z.string().describe("技能模块id"),
  domainId: z.string().describe("技能域id")
});

const invokeSkillInputSchema = z.object({
  skillId: z.string().describe("技能 id ")
});

export const findSkillsTool = {
  name: "find_skills",
  description: "按 domainId查询所有 skills 的简要信息",
  schema: listSkillsInputSchema
};

export async function findSkills(
  domainId: string,
): Promise<string> {
  const skills = listSkills(domainId).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    domainId: s.domainId,
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
  detail: SkillDetail,
  maxChars: number
): SkillDetail {
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
  } as SkillDetail;
}

/**
 * @param options.maxGuideBodyChars 仅截断嵌套 `skill.body`（Guide），不影响 dataQuery 等不传该参数时的全文
 */
export async function runInvokeSkillTool(
  skillId: string,
  options: { maxGuideBodyChars?: number } = { maxGuideBodyChars: 8000 }
): Promise<string> {
  const detail = getSkillDetailById(skillId);
  if (!detail) {
    return JSON.stringify({ ok: false, error: `skill 不存在: ${skillId}` });
  }
  const max = options.maxGuideBodyChars;
  const payload =
    max !== undefined && max > 0
      ? truncateGuideBodyInDetail(detail, max)
      : detail;
  return JSON.stringify({ ok: true, skill: payload }, null, 2);
}
