import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod/v3";

/** 缺参澄清场景的轻量文案结构化输出（不改变 planningTasks 等结构） */
export const ClarificationToneResultSchema = z.object({
  clarificationQuestion: z
    .string()
    .min(1)
    .describe("面向用户的澄清问句，语气可自然轻松，须覆盖待补充项"),
  replySuggestion: z
    .string()
    .optional()
    .describe("简短跟进提示；若无需补充可省略")
});

export type ClarificationToneResult = z.infer<typeof ClarificationToneResultSchema>;

let cached: StructuredOutputParser<typeof ClarificationToneResultSchema> | undefined;

export function getClarificationToneOutputParser(): StructuredOutputParser<
  typeof ClarificationToneResultSchema
> {
  if (!cached) {
    cached = StructuredOutputParser.fromZodSchema(ClarificationToneResultSchema);
  }
  return cached;
}
