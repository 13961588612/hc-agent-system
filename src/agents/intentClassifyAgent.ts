import type { OrchestratorState } from "../contracts/schemas.js";
import { getIntentResultSchema } from "../contracts/intentSchemas.js";
import { log } from "../lib/log/log.js";
import { applyIntentDeterministicPlanning } from "../intent/plan/planner.js";
import {
  applyIntentSeparate,
  type IntentLlmRawMessage
} from "../../separate/intentSeparate.js";
import { IntentSeparateResult } from "../intent/plan/index.js";

/** 失败兜底：blocked 意图结果 */
function buildIntentClassifyBlockedFallback(): NonNullable<
  OrchestratorState["intentResult"]
> {
  //应调用之前的全量识别结果，
  return {
    intents: [
      {
        intent: "unknown",
        goal: "意图识别失败，等待用户补充",
        semanticTaskBrief: "无法解析用户请求，待补充有效意图与查询条件",
        executable: false,
        needsClarification: true,
        missingSlots: ["intent_parse_failed"]
      }
    ],
    planPhase: "blocked",
    planningTasks: [
      {
        taskId: "task-intent-fallback",
        systemModuleId: "unknown",
        goal: "恢复意图识别并收集必要信息",
        missingSlots: ["intent_parse_failed"],
        executable: false
      }
    ],
    needsClarification: true,
    clarificationQuestion:
      "我这边暂时无法稳定解析你的请求。请补充：你要查询的业务对象、时间范围、以及可用标识（如会员号/手机号/订单号）。",
    replySuggestion: "请提供更具体的查询条件后我再继续。"
  };
}

/**
 * LLM 结构化意图 + 程序化 data_query 规划；与 `highLevelDomain` 在同一出口对齐。
 */
export async function runIntentClassifyAgent(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Pick<OrchestratorState, "intentResult" | "highLevelDomain">> {
  const userInput = state.input.userInput;
  let lastRawMsg: IntentLlmRawMessage | undefined;
  const tAll = Date.now();
  log(
    "[Intent]",
    "classify 开始",
    `userInputLen=${userInput.length} historyTurns=${(state.conversationTurns ?? []).length}`
  );

  try {
    const intentSeparatePayload: IntentSeparateResult = await applyIntentSeparate(state,config);
    const patched = await applyIntentDeterministicPlanning(
      intentSeparatePayload,
      userInput
    );
    return { intentResult: patched };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(
      "[Intent]",
      "classify 失败（将返回 blocked 兜底）",
      `${msg}${lastRawMsg ? ` | raw=${JSON.stringify(lastRawMsg).slice(0, 2000)}` : ""}`,
      tAll
    );
    return {
      intentResult: buildIntentClassifyBlockedFallback()
    };
  }
}
