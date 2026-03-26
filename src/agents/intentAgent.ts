import type { OrchestratorState } from "../contracts/schemas.js";

/**
 * 意图识别 Agent：根据 userInput 判断高层域（data_query / other）
 */
export function runIntentAgent(state: OrchestratorState): OrchestratorState {
  const text = state.input.userInput;
  const isDataQuery =
    text.includes("查") ||
    text.includes("查询") ||
    text.includes("订单") ||
    text.includes("积分") ||
    text.includes("会员");
  return {
    ...state,
    highLevelDomain: isDataQuery ? "data_query" : "other"
  };
}
