import { getMaxClarificationRounds } from "../../config/intentPolicy.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";

/** 非澄清类回复：清空追问 streak */
const clearedClarification = {
  clarificationRound: 0,
  lastClarificationAtMs: 0
} as const;

function wantsClarification(ir: OrchestratorState["intentResult"]): boolean {
  if (!ir) return false;
  if (ir.needsClarification && ir.clarificationQuestion?.trim()) return true;
  if (ir.missingSlots?.length) return true;
  return false;
}

function assistantSnippetFromFinalAnswer(finalAnswer: unknown): string {
  if (finalAnswer && typeof finalAnswer === "object") {
    const o = finalAnswer as Record<string, unknown>;
    if (o.type === "clarification" && typeof o.message === "string") {
      return o.message.slice(0, 2000);
    }
    if (o.type === "chitchat" && typeof o.message === "string") {
      return o.message.slice(0, 2000);
    }
    if (o.type === "fallback" && typeof o.message === "string") {
      return o.message.slice(0, 2000);
    }
    if (o.type === "data_query") return "已返回数据查询结果。";
  }
  return "已完成处理。";
}

function logComposeDone(
  t0: number,
  partial: Partial<OrchestratorState>
): Partial<OrchestratorState> {
  const fa = partial.finalAnswer;
  const hint =
    fa && typeof fa === "object" && fa !== null && "type" in fa
      ? String((fa as { type: unknown }).type)
      : typeof fa;
  log("[Orchestrator]", "node compose_answer 结束", `finalAnswer.type=${hint}`, t0);
  return partial;
}

export function composeAnswerNode(
  state: OrchestratorState
): Partial<OrchestratorState> {
  const t0 = Date.now();
  const riKeys = state.resultsIndex ? Object.keys(state.resultsIndex).length : 0;
  log(
    "[Orchestrator]",
    "node compose_answer 开始",
    `primaryIntent=${state.intentResult?.primaryIntent ?? "none"} resultsIndexKeys=${riKeys} clarificationRound=${state.clarificationRound ?? 0}`
  );

  const ir = state.intentResult;
  const maxR = getMaxClarificationRounds();
  const round = state.clarificationRound ?? 0;

  if (wantsClarification(ir) && round >= maxR) {
    log(
      "[Orchestrator]",
      "clarification 达上限",
      `round=${round} max=${maxR}`,
      t0
    );
    const message = "追问次数已达上限，请换一种说法或重新描述问题。";
    const finalAnswer = { type: "fallback" as const, message };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: message.slice(0, 2000) }
      ]
    });
  }

  if (ir?.needsClarification && ir.clarificationQuestion?.trim()) {
    const message = ir.clarificationQuestion.trim();
    const finalAnswer = { type: "clarification" as const, message };
    return logComposeDone(t0, {
      finalAnswer,
      clarificationRound: round + 1,
      lastClarificationAtMs: Date.now(),
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  /** 第二期：缺槽位但未走 needsClarification 追问句时，仍合成澄清 */
  if (ir?.missingSlots?.length) {
    const message =
      ir.clarificationQuestion?.trim() ||
      `请补充以下信息以便查询：${ir.missingSlots.join("、")}`;
    const finalAnswer = { type: "clarification" as const, message };
    return logComposeDone(t0, {
      finalAnswer,
      clarificationRound: round + 1,
      lastClarificationAtMs: Date.now(),
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  /** 里程碑 6.2：Guide 精参缺失（本回合已进过 guide_agent） */
  if (
    state.guideMissingParams?.length &&
    ir?.primaryIntent === "data_query"
  ) {
    const message = `请补充以下信息以便查询：${state.guideMissingParams.join("、")}`;
    const finalAnswer = { type: "clarification" as const, message };
    return logComposeDone(t0, {
      finalAnswer,
      clarificationRound: round + 1,
      lastClarificationAtMs: Date.now(),
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  if (state.resultsIndex && Object.keys(state.resultsIndex).length > 0) {
    const finalAnswer = {
      type: "data_query" as const,
      resultsIndex: state.resultsIndex
    };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  if (ir?.primaryIntent === "chitchat") {
    const message =
      ir.replySuggestion?.trim() ||
      "您好！如需查询订单或会员积分等数据，请告诉我具体需求。";
    const finalAnswer = { type: "chitchat" as const, message };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  if (ir?.primaryIntent === "unknown") {
    const message =
      ir.replySuggestion?.trim() ||
      "当前仅支持简单的数据查询示例，请尝试询问订单或会员积分相关问题。";
    const finalAnswer = { type: "fallback" as const, message };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  if (ir?.primaryIntent === "data_query") {
    const message = "数据查询未能完成或未返回结果，请换一种说法或稍后再试。";
    const finalAnswer = { type: "fallback" as const, message };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  const message =
    "当前仅支持简单的数据查询示例，请尝试询问订单或会员积分相关问题。";
  const finalAnswer = { type: "fallback" as const, message };
  return logComposeDone(t0, {
    ...clearedClarification,
    finalAnswer,
    conversationTurns: [
      { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
    ]
  });
}
