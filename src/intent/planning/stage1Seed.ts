import type { Stage1IntentPayload } from "./stage1IntentSchema.js";

/**
 * 将 Stage1 LLM 输出转为可喂给 `getIntentResultSchema().parse` 的种子对象，
 * 再经程序化规划补全 data_query 等字段。
 */
export function buildSeedIntentResultFromStage1(stage1: Stage1IntentPayload) {
  return {
    intents: stage1.intents.map((x) => ({
      intent: x.intent,
      goal: x.goal,
      semanticTaskBrief: x.semanticTaskBrief,
      confidence: x.confidence,
      resolvedSlots: x.resolvedSlots,
      domainId: x.domainId,
      segmentId: x.segmentId
    })),
    needsClarification: false,
    replyLocale: stage1.replyLocale,
    confidence: stage1.confidence,
    replySuggestion: stage1.replySuggestion
  };
}
