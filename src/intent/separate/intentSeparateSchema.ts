import { z } from "zod/v3";
import { IntentTypeSchema } from "../../contracts/intentSchemas.js";

export const IntentSeparateItemSchema = z.object({
  intent: IntentTypeSchema.describe(
    "子意图类型，须为 data_query | data_analysis | knowledge_qa | chitchat | unknown 之一"
  ),
  goal: z
    .string()
    .optional()
    .describe("该子意图的自然语言目标；具体标识宜放入 resolvedSlots"),
  semanticTaskBrief: z
    .string()
    .min(1)
    .describe(
      "无语义负载的任务简述：说明任务类型与数据范畴，不含手机号/会员号/订单号等；具体值放 resolvedSlots"
    ),
  confidence: z
    .number()
    .optional()
    .describe("模型对该子意图的置信度，建议 0～1"),
  resolvedSlots: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("已解析槽位，键名建议 snake_case"),
  domainId: z
    .string()
    .optional()
    .describe("业务或系统域 id，建议与 config/system.yaml 中域配置对齐"),
  segmentId: z
    .string()
    .optional()
    .describe("业务分段 id，建议与 config/system.yaml 中 segment 对齐")
});

/**
 * 第一阶段 LLM 仅输出轻量意图结构：
 * - intents[]: 意图、semanticTaskBrief（必）、goal、可选槽位/分段
 * - replyLocale/replySuggestion/confidence: 可选
 */
export const IntentSeparateResultSchema = z.object({
  intents: z
    .array(IntentSeparateItemSchema)
    .min(1)
    .describe("多意图列表，至少一条子意图"),
  replyLocale: z
    .enum(["zh", "en", "auto", "zh-CN", "zh-TW", "en-US", "en-GB"])
    .optional()
    .describe("回复语言：简中/英及常见 BCP-47 变体；不确定时可省略"),
  confidence: z
    .number()
    .optional()
    .describe("全局意图分类置信度，建议 0～1"),
  replySuggestion: z
    .string()
    .optional()
    .describe("面向用户的全局简短回复建议，常用于 chitchat/unknown 等")
});

export type IntentSeparateResult = z.infer<typeof IntentSeparateResultSchema>;
