import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { getIntentSeparateResultSchema } from "./intentSeparateSchema.js";
let cachedParser;
let cachedSchemaRef;
/**
 * 意图拆分结果：与 LLM 约定 JSON 形态，并用 Zod 校验。
 * 随 {@link refreshIntentSeparateSchemaCache} 更新底层 schema。
 */
export function getIntentSeparateOutputParser() {
    const schema = getIntentSeparateResultSchema();
    if (!cachedParser || cachedSchemaRef !== schema) {
        cachedParser = StructuredOutputParser.fromZodSchema(schema);
        cachedSchemaRef = schema;
    }
    return cachedParser;
}
//# sourceMappingURL=intentSeparateOutputParser.js.map