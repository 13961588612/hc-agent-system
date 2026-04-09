import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import {
  getIntentInvokeBodyMaxChars,
  getIntentToolMaxRounds
} from "../../config/intentPolicy.js";
import { log } from "../../lib/log/log.js";
import { getModel } from "../../model/index.js";
import { runInvokeSkillTool } from "../../lib/tools/skillsTools.js";
import { allTools, TOOL_HANDLERS } from "../../lib/tools/tools.js";
import { INTENT_COMMON_GUIDE_ID } from "./intentPromptUtils.js";

/** 参数键排序后 JSON，便于判断「同工具 + 同参」（跨轮次复用结果） */
function toolArgsCacheKey(args: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(args).sort()) {
    sorted[k] = args[k];
  }
  return JSON.stringify(sorted);
}

export async function runIntentWithSkillTools(
  systemInstruction: string,
  userPrompt: string,
  tools: unknown[]
): Promise<unknown> {
  const llm = getModel();
  const bindTools = (llm as { bindTools?: (tools: unknown[]) => { invoke: (x: unknown) => Promise<unknown> } })
    .bindTools;
  if (!bindTools) {
    log("[Intent]", "LLM tool 绑定", "跳过：当前模型无 bindTools，将直接 invoke（无工具阶段）");
    log(
      "[Intent]",
      "prompt 规模（意图阶段·无工具）",
      `systemChars=${systemInstruction.length} userChars=${userPrompt.length}`
    );
    const t0 = Date.now();
    const out = await llm.invoke([
      new SystemMessage(systemInstruction),
      new HumanMessage(userPrompt)
    ]);
    log("[Intent]", "LLM 单轮 invoke", `耗时=${Date.now() - t0}ms`);
    return out;
  }
  const modelWithTools = bindTools.call(llm, [
    ...tools
  ]);

  const messages: Array<SystemMessage | HumanMessage | ToolMessage | { content: unknown; tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }> = [
    new SystemMessage(systemInstruction),
    new HumanMessage(userPrompt)
  ];
  const maxToolRounds = getIntentToolMaxRounds();
  const bodyMax = getIntentInvokeBodyMaxChars();
  log(
    "[Intent]",
    "prompt 规模（意图阶段）",
    `systemChars=${systemInstruction.length} userChars=${userPrompt.length} toolMaxRounds=${maxToolRounds} invokeBodyMaxChars=${bodyMax ?? "full"}`
  );

  /** 单次意图 invoke 内跨多轮 LLM：相同 tool + 相同参数只执行一次 */
  const toolResultCache = new Map<string, string>();

  for (let i = 0; i < maxToolRounds; i++) {
    const tRound = Date.now();
    const aiMsg = (await modelWithTools.invoke(messages)) as {
      content: unknown;
      tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
    };
    log(
      "[Intent]",
      `LLM 第 ${i + 1} 轮`,
      `耗时=${Date.now() - tRound}ms msgCount=${messages.length}`
    );
    const calls = aiMsg.tool_calls ?? [];
    if (calls.length > 0) {
      log(
        "[Intent]",
        `tool 轮次 ${i + 1}：模型请求调用`,
        calls.map((c) => c.name ?? "?").join(", ")
      );
    }

    messages.push(aiMsg);
    if (calls.length === 0) return aiMsg;

    for (let j = 0; j < calls.length; j++) {
      const c = calls[j]!;
      const name = c.name ?? "";
      const args = (c.args ?? {}) as Record<string, unknown>;
      const dedupeKey = `${name}\0${toolArgsCacheKey(args)}`;
      const cached = toolResultCache.get(dedupeKey);
      if (cached !== undefined) {
        log(
          "[Intent]",
          "tool 去重命中（多轮共享缓存）",
          `${name} llmRound=${i + 1} idx=${j}`
        );
        messages.push(
          new ToolMessage({
            tool_call_id: c.id ?? `call_${i}_${j}`,
            content: cached
          })
        );
        continue;
      }

      let toolResult = JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
      try {
        if (name === "invoke_skill") {
          const skillId = String(args["skillId"] ?? "").trim();
          if (skillId === INTENT_COMMON_GUIDE_ID) {
            toolResult = JSON.stringify({
              ok: true,
              hint: `「${INTENT_COMMON_GUIDE_ID}」规则已在系统提示中完整给出，请勿重复 invoke。请改用工具查询业务域技能，并在最后一轮直接输出 JSON（无 tool_calls）。`
            });
          } else {
            toolResult = await runInvokeSkillTool(skillId);
          }
        } else if (TOOL_HANDLERS[name]) {
          toolResult = await TOOL_HANDLERS[name](args);
        } else {
          toolResult = JSON.stringify({
            ok: false,
            error: `unknown tool: ${name}`
          });
        }
      } catch (e) {
        toolResult = JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        });
      }
      toolResultCache.set(dedupeKey, toolResult);
      messages.push(
        new ToolMessage({
          tool_call_id: c.id ?? `call_${i}_${j}`,
          content: toolResult
        })
      );
    }
  }
  throw new Error(`intent_tool_call_exceeded（已超过 INTENT_TOOL_MAX_ROUNDS=${maxToolRounds}）`);
}

