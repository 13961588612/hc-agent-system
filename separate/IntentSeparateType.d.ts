import z from "zod";
import { LocaleSchema } from "../src/contracts/schemas.js";
export type IntentSeparateItem = {
    intent: string;
    goal: string;
    semanticTaskBrief: string;
    confidence: number;
    resolvedSlots: Record<string, unknown>;
    moduleId: string;
    domainId: string;
};
export type IntentSeparateResult = {
    intents: IntentSeparateItem[];
    replyLocale: z.infer<typeof LocaleSchema>;
    confidence: number;
    replySuggestion: string;
};
