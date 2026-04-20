import { z } from "zod/v3";
import { FALLBACK_SYSTEM_CONFIG, } from "../src/contracts/intentSchemas.js";
import { LocaleSchema } from "../src/contracts/schemas.js";
import { getDomainIdDescription, getDomainIdSchema, getIntentionIdDescription, getIntentionIdSchema } from "../src/contracts/SystemSchema.js";
/**
 * 按当前 `system.yaml` 构造阶段一拆分 schema（与 {@link buildSystemSchemas} / {@link buildIntentResultSchema} 同源数据）。
 */
export function buildIntentTypeSchema() {
    return getIntentionIdSchema();
}
export function buildIntentSeparateItemSchema() {
    return z.object({
        intent: buildIntentTypeSchema().describe("意图类型," + getIntentionIdDescription()),
        goal: z.string().optional().describe("该子意图的自然语言目标；具体标识宜放入 resolvedSlots"),
        semanticTaskBrief: z.string().min(1).describe("无语义负载的任务简述：说明任务类型与数据范畴；比如按手机号查询一段时间内的会员消费记录和会员当前积分余额；不含手机号/会员号/订单号等具体值，具体值放 resolvedSlots"),
        confidence: z.number().optional().describe("模型对该子意图的置信度，建议 0～1"),
        resolvedSlots: z.record(z.string(), z.unknown()).optional().describe("已解析槽位，键名建议 snake_case"),
        intentionId: z.string().describe("意图唯一标识,intention-01,intention-02,..."),
        domainId: getDomainIdSchema().describe("域 id," + getDomainIdDescription()),
    });
}
export function buildIntentSeparateResultSchema() {
    return z.object({
        intents: z.array(buildIntentSeparateItemSchema()).min(1).describe("多意图列表，至少一条子意图"),
        replyLocale: LocaleSchema.optional().describe("回复语言：简中/英及常见 BCP-47；不确定时可省略"),
        confidence: z.number().optional().describe("全局意图分类置信度，建议 0～1"),
        replySuggestion: z.string().optional().describe("面向用户的全局简短回复建议，常用于 chitchat/unknown 等")
    });
}
export function buildIntentSeparateSchemas(_config) {
    void _config;
    const itemSchema = buildIntentSeparateItemSchema();
    const resultSchema = buildIntentSeparateResultSchema();
    return { itemSchema, resultSchema };
}
let cachedSeparate;
function ensureIntentSeparateCached() {
    if (!cachedSeparate) {
        cachedSeparate = buildIntentSeparateSchemas(FALLBACK_SYSTEM_CONFIG);
    }
    return cachedSeparate;
}
export function getIntentSeparateItemSchema() {
    return ensureIntentSeparateCached().itemSchema;
}
export function getIntentSeparateResultSchema() {
    return ensureIntentSeparateCached().resultSchema;
}
/** 与 {@link refreshIntentResultSchemaCache} 一起在 `initCore` 后调用 */
export function refreshIntentSeparateSchemaCache(config) {
    cachedSeparate = buildIntentSeparateSchemas(config);
}
export function resetIntentSeparateSchemaCacheForTests() {
    cachedSeparate = undefined;
}
//# sourceMappingURL=intentSeparateSchema.js.map