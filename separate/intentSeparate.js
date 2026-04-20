import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getIntentLlmTimeoutMs } from "../src/config/intentPolicy.js";
import { log } from "../src/lib/log/log.js";
import { getIntentSeparateOutputParser } from "./intentSeparateOutputParser.js";
import { buildIntentSeparateInstruction } from "../src/intent/common/intentPromptUtils.js";
import { allTools } from "../src/lib/tools/tools.js";
import { getModelNoThinking } from "../src/model/index.js";
import { emitProgressByConfig } from "../src/graph/orchestrator/progressReporter.js";
/** 阶段1：构造用户侧内容（最近对话 + 当前输入） */
export function buildIntentLlmUserContent(state) {
    const userInput = state.input.userInput;
    const historyLines = (state.conversationTurns ?? [])
        .slice(-10)
        .map((t) => `${t.role}: ${t.content}`);
    const historyBlock = historyLines.length > 0
        ? `【最近对话】\n${historyLines.join("\n")}\n\n`
        : "";
    return `${historyBlock}【当前用户输入】\n${userInput}`;
}
/**
 * 阶段2：`bindTools` + `withStructuredOutput(StructuredOutputParser)`，
 * 一次 Runnable 内完成工具绑定与结构化意图结果解析（由 LangChain 与 Zod 校验）。
 */
export async function runIntentSeparateLlm(userContent) {
    const instruction = await buildIntentSeparateInstruction();
    const tLlm = Date.now();
    const timeoutMs = getIntentLlmTimeoutMs();
    log("[Intent]", "getModel + LLM invoke 开始", `timeoutMs=${timeoutMs}`);
    const tools = [
        allTools.find_skills,
        allTools.invoke_skill
    ];
    const base = getModelNoThinking(true);
    /** OpenAI：与 `withStructuredOutput` 联用时须 `strict: true`，否则报「Only strict function tools can be auto-parsed」 */
    const chain = base
        .bindTools(tools, { strict: true })
        .withStructuredOutput(getIntentSeparateOutputParser());
    const out = await Promise.race([
        chain.invoke([
            new SystemMessage(instruction),
            new HumanMessage(userContent)
        ]),
        new Promise((_, rej) => {
            setTimeout(() => rej(new Error("intent_llm_timeout")), timeoutMs);
        })
    ]);
    log("[Intent]", "LLM invoke 结束（StructuredOutput 已解析）", JSON.stringify(out), tLlm);
    return out;
}
export async function applyIntentSeparate(state, config) {
    const userContent = buildIntentLlmUserContent(state);
    const intentSeparateResult = await runIntentSeparateLlm(userContent);
    const message = buildIntentSeparateProgressMessage(intentSeparateResult);
    try {
        console.log("intentSeparate message", message);
        await emitProgressByConfig(config, message);
    }
    catch (error) {
        log("[Intent]", "emitProgressByConfig 失败", error instanceof Error ? error.message : String(error));
    }
    return intentSeparateResult;
}
function buildIntentSeparateProgressMessage(intentSeparateResult) {
    let message = `意图切分结束`;
    if (intentSeparateResult.replySuggestion) {
        message += `，${intentSeparateResult.replySuggestion}`;
    }
    return message;
}
//# sourceMappingURL=intentSeparate.js.map