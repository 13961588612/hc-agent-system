import type { IntentSeparatePayload } from "./intentSeparateSchema.js";

/**
 * 将 intentSeparate LLM 输出转为可喂给 `getIntentResultSchema().parse` 的种子对象，
 * 再经程序化规划补全 data_query 等字段。
 */
export function buildSeedIntentResultFromIntentSeparate(intentSeparate: IntentSeparatePayload) {
  return {
    intents: intentSeparate.intents.map((x) => ({
      intent: x.intent,
      goal: x.goal,
      semanticTaskBrief: x.semanticTaskBrief,
      confidence: x.confidence,
      resolvedSlots: x.resolvedSlots,
      domainId: x.domainId,
      segmentId: x.segmentId
    })),
    needsClarification: false,
    replyLocale: intentSeparate.replyLocale,
    confidence: intentSeparate.confidence,
    replySuggestion: intentSeparate.replySuggestion
  };
}
