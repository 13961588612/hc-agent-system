import { z } from "zod/v3";
import { IntentTypeSchema } from "../../contracts/intentSchemas.js";

export const Stage1IntentItemSchema = z.object({
  intent: IntentTypeSchema,
  goal: z.string().optional(),
  /**
   * 不含具体业务标识值的语义完备简述：说明任务类型与数据范畴，供复用与对齐；具体值放 resolvedSlots。
   */
  semanticTaskBrief: z.string().min(1),
  confidence: z.number().optional(),
  resolvedSlots: z.record(z.string(), z.unknown()).optional(),
  domainId: z.string().optional(),
  segmentId: z.string().optional()
});

/**
 * 第一阶段 LLM 仅输出轻量意图结构：
 * - intents[]: 意图、semanticTaskBrief（必）、goal、可选槽位/分段
 * - replyLocale/replySuggestion/confidence: 可选
 */
export const Stage1IntentPayloadSchema = z.object({
  intents: z.array(Stage1IntentItemSchema).min(1),
  replyLocale: z.enum(["zh", "en", "auto"]).optional(),
  confidence: z.number().optional(),
  replySuggestion: z.string().optional()
});

export type Stage1IntentPayload = z.infer<typeof Stage1IntentPayloadSchema>;

