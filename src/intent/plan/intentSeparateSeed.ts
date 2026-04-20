import type { IntentSeparateResult } from "../../../separate/IntentSeparateType.js";
import type { IntentResult } from "../../contracts/intentSchemas.js";

/** 将阶段一拆分结果规范为 IntentResult 可用的根级 `replyLocale`。 */
function normalizeReplyLocale(
  loc: IntentSeparateResult["replyLocale"] | undefined
): IntentResult["replyLocale"] {
  if (!loc) return undefined;
  if (loc === "zh" || loc === "en" || loc === "auto") return loc;
  if (typeof loc === "string" && loc.startsWith("zh")) return "zh";
  if (typeof loc === "string" && loc.startsWith("en")) return "en";
  return undefined;
}

/**
 * 由阶段一拆分结果构造阶段二 IntentResult 种子，供 `getIntentResultSchema().parse` 与规划回写使用。
 */
export function buildSeedIntentResultFromIntentSeparate(
  separate: IntentSeparateResult
): IntentResult {
  return {
    intents: separate.intents.map((it) => ({
      intent: it.intent,
      goal: it.goal,
      semanticTaskBrief: it.semanticTaskBrief,
      confidence: it.confidence,
      resolvedSlots: it.resolvedSlots,
      domainId: it.domainId
    })),
    planPhase: "draft",
    needsClarification: false,
    replyLocale: normalizeReplyLocale(separate.replyLocale),
    confidence: separate.confidence,
    replySuggestion: separate.replySuggestion
  } as IntentResult;
}
