import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { IntentSeparateResultSchema } from "./intentSeparateSchema.js";

let cached: StructuredOutputParser<typeof IntentSeparateResultSchema> | undefined;

/**
 * 意图拆分结果：与 LLM 约定 JSON 形态，并用 Zod 校验。
 * 单例，供系统提示中的 format instructions 与解析共用。
 */
export function getIntentSeparateOutputParser(): StructuredOutputParser<
  typeof IntentSeparateResultSchema
> {
  if (!cached) {
    cached = StructuredOutputParser.fromZodSchema(IntentSeparateResultSchema);
  }
  return cached;
}
