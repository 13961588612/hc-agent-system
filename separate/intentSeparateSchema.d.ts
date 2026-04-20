import { z } from "zod/v3";
import type { SystemConfig } from "../src/config/systemConfig.js";
/**
 * 按当前 `system.yaml` 构造阶段一拆分 schema（与 {@link buildSystemSchemas} / {@link buildIntentResultSchema} 同源数据）。
 */
export declare function buildIntentTypeSchema(): z.ZodEnum<[string, ...string[]]>;
export declare function buildIntentSeparateItemSchema(): z.ZodObject<{
    intent: z.ZodEnum<[string, ...string[]]>;
    goal: z.ZodOptional<z.ZodString>;
    semanticTaskBrief: z.ZodString;
    confidence: z.ZodOptional<z.ZodNumber>;
    resolvedSlots: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    intentionId: z.ZodString;
    domainId: z.ZodEnum<[string, ...string[]]>;
}, "strip", z.ZodTypeAny, {
    intent: string;
    semanticTaskBrief: string;
    domainId: string;
    intentionId: string;
    goal?: string | undefined;
    resolvedSlots?: Record<string, unknown> | undefined;
    confidence?: number | undefined;
}, {
    intent: string;
    semanticTaskBrief: string;
    domainId: string;
    intentionId: string;
    goal?: string | undefined;
    resolvedSlots?: Record<string, unknown> | undefined;
    confidence?: number | undefined;
}>;
export declare function buildIntentSeparateResultSchema(): z.ZodObject<{
    intents: z.ZodArray<z.ZodObject<{
        intent: z.ZodEnum<[string, ...string[]]>;
        goal: z.ZodOptional<z.ZodString>;
        semanticTaskBrief: z.ZodString;
        confidence: z.ZodOptional<z.ZodNumber>;
        resolvedSlots: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        intentionId: z.ZodString;
        domainId: z.ZodEnum<[string, ...string[]]>;
    }, "strip", z.ZodTypeAny, {
        intent: string;
        semanticTaskBrief: string;
        domainId: string;
        intentionId: string;
        goal?: string | undefined;
        resolvedSlots?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
    }, {
        intent: string;
        semanticTaskBrief: string;
        domainId: string;
        intentionId: string;
        goal?: string | undefined;
        resolvedSlots?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
    }>, "many">;
    replyLocale: z.ZodOptional<z.ZodEnum<["zh", "en", "auto", "zh-CN", "zh-TW", "en-US", "en-GB"]>>;
    confidence: z.ZodOptional<z.ZodNumber>;
    replySuggestion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    intents: {
        intent: string;
        semanticTaskBrief: string;
        domainId: string;
        intentionId: string;
        goal?: string | undefined;
        resolvedSlots?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
    }[];
    confidence?: number | undefined;
    replySuggestion?: string | undefined;
    replyLocale?: "zh" | "en" | "auto" | "zh-CN" | "zh-TW" | "en-US" | "en-GB" | undefined;
}, {
    intents: {
        intent: string;
        semanticTaskBrief: string;
        domainId: string;
        intentionId: string;
        goal?: string | undefined;
        resolvedSlots?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
    }[];
    confidence?: number | undefined;
    replySuggestion?: string | undefined;
    replyLocale?: "zh" | "en" | "auto" | "zh-CN" | "zh-TW" | "en-US" | "en-GB" | undefined;
}>;
export declare function buildIntentSeparateSchemas(_config: SystemConfig): {
    itemSchema: z.ZodObject<{
        intent: z.ZodEnum<[string, ...string[]]>;
        goal: z.ZodOptional<z.ZodString>;
        semanticTaskBrief: z.ZodString;
        confidence: z.ZodOptional<z.ZodNumber>;
        resolvedSlots: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        intentionId: z.ZodString;
        domainId: z.ZodEnum<[string, ...string[]]>;
    }, "strip", z.ZodTypeAny, {
        intent: string;
        semanticTaskBrief: string;
        domainId: string;
        intentionId: string;
        goal?: string | undefined;
        resolvedSlots?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
    }, {
        intent: string;
        semanticTaskBrief: string;
        domainId: string;
        intentionId: string;
        goal?: string | undefined;
        resolvedSlots?: Record<string, unknown> | undefined;
        confidence?: number | undefined;
    }>;
    resultSchema: z.ZodObject<{
        intents: z.ZodArray<z.ZodObject<{
            intent: z.ZodEnum<[string, ...string[]]>;
            goal: z.ZodOptional<z.ZodString>;
            semanticTaskBrief: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            resolvedSlots: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            intentionId: z.ZodString;
            domainId: z.ZodEnum<[string, ...string[]]>;
        }, "strip", z.ZodTypeAny, {
            intent: string;
            semanticTaskBrief: string;
            domainId: string;
            intentionId: string;
            goal?: string | undefined;
            resolvedSlots?: Record<string, unknown> | undefined;
            confidence?: number | undefined;
        }, {
            intent: string;
            semanticTaskBrief: string;
            domainId: string;
            intentionId: string;
            goal?: string | undefined;
            resolvedSlots?: Record<string, unknown> | undefined;
            confidence?: number | undefined;
        }>, "many">;
        replyLocale: z.ZodOptional<z.ZodEnum<["zh", "en", "auto", "zh-CN", "zh-TW", "en-US", "en-GB"]>>;
        confidence: z.ZodOptional<z.ZodNumber>;
        replySuggestion: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        intents: {
            intent: string;
            semanticTaskBrief: string;
            domainId: string;
            intentionId: string;
            goal?: string | undefined;
            resolvedSlots?: Record<string, unknown> | undefined;
            confidence?: number | undefined;
        }[];
        confidence?: number | undefined;
        replySuggestion?: string | undefined;
        replyLocale?: "zh" | "en" | "auto" | "zh-CN" | "zh-TW" | "en-US" | "en-GB" | undefined;
    }, {
        intents: {
            intent: string;
            semanticTaskBrief: string;
            domainId: string;
            intentionId: string;
            goal?: string | undefined;
            resolvedSlots?: Record<string, unknown> | undefined;
            confidence?: number | undefined;
        }[];
        confidence?: number | undefined;
        replySuggestion?: string | undefined;
        replyLocale?: "zh" | "en" | "auto" | "zh-CN" | "zh-TW" | "en-US" | "en-GB" | undefined;
    }>;
};
export declare function getIntentSeparateItemSchema(): ReturnType<typeof buildIntentSeparateItemSchema>;
export declare function getIntentSeparateResultSchema(): ReturnType<typeof buildIntentSeparateResultSchema>;
/** 与 {@link refreshIntentResultSchemaCache} 一起在 `initCore` 后调用 */
export declare function refreshIntentSeparateSchemaCache(config: SystemConfig): void;
export declare function resetIntentSeparateSchemaCacheForTests(): void;
