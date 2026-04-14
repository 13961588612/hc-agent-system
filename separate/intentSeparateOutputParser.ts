import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { z } from "zod/v3";
import { getIntentSeparateResultSchema } from "./intentSeparateSchema.js";

let cachedParser: StructuredOutputParser<z.ZodType> | undefined;
let cachedSchemaRef: z.ZodType | undefined;

/**
 * 意图拆分结果：与 LLM 约定 JSON 形态，并用 Zod 校验。
 * 随 {@link refreshIntentSeparateSchemaCache} 更新底层 schema。
 */
export function getIntentSeparateOutputParser(): StructuredOutputParser<z.ZodType> {
  const schema = getIntentSeparateResultSchema();
  if (!cachedParser || cachedSchemaRef !== schema) {
    cachedParser = StructuredOutputParser.fromZodSchema(schema);
    cachedSchemaRef = schema;
  }
  return cachedParser;
}
