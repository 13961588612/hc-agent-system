import type { OrchestratorState } from "../../contracts/schemas.js";

export function composeAnswerNode(
  state: OrchestratorState
): Partial<OrchestratorState> {
  if (state.resultsIndex && Object.keys(state.resultsIndex).length > 0) {
    return {
      ...state,
      finalAnswer: {
        type: "data_query",
        resultsIndex: state.resultsIndex
      }
    };
  }
  return {
    ...state,
    finalAnswer: {
      type: "fallback",
      message:
        "当前仅支持简单的数据查询示例，请尝试询问订单或会员积分相关问题。"
    }
  };
}
