interface ReusableStepTemplate {
  skillsDomainId: string;
  skillsSegmentId?: string;
  selectedSkillId: string;
  selectedSkillKind: "skill" | "guide";
  requiredParams: string[];
  executionSkillId?: string;
  dbClientKey?: string;
  expectedOutput?: string;
  /** 最近一次同类任务 `semanticTaskBrief` 的嵌入向量，用于下一轮相似度 */
  briefEmbedding?: number[];
}

const reuseStore = new Map<string, ReusableStepTemplate>();

function keyOf(segmentId: string, selectedSkillId: string): string {
  return `${segmentId}::${selectedSkillId}`;
}

export function getReusableStepTemplate(
  segmentId: string,
  selectedSkillId: string
): ReusableStepTemplate | undefined {
  return reuseStore.get(keyOf(segmentId, selectedSkillId));
}

export function saveReusableStepTemplate(
  segmentId: string,
  template: ReusableStepTemplate
): void {
  if (!segmentId.trim() || !template.selectedSkillId.trim()) return;
  reuseStore.set(keyOf(segmentId, template.selectedSkillId), {
    ...template,
    requiredParams: [...template.requiredParams],
    ...(template.briefEmbedding?.length
      ? { briefEmbedding: [...template.briefEmbedding] }
      : {})
  });
}

