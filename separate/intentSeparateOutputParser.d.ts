import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { z } from "zod/v3";
/**
 * 意图拆分结果：与 LLM 约定 JSON 形态，并用 Zod 校验。
 * 随 {@link refreshIntentSeparateSchemaCache} 更新底层 schema。
 */
export declare function getIntentSeparateOutputParser(): StructuredOutputParser<z.ZodType>;
