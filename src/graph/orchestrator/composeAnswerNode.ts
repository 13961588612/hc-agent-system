import { getMaxClarificationRounds } from "../../config/intentPolicy.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { emitProgressByConfig } from "./progressReporter.js";
import {
  getBestDataQueryIntent,
  getBestIntentByType,
  getDominantIntentFromList
} from "./intentSelectors.js";

type IntentResultNonNull = NonNullable<OrchestratorState["intentResult"]>;

/** 非澄清类回复：清空追问 streak */
const clearedClarification = {
  clarificationRound: 0,
  lastClarificationAtMs: 0
} as const;

function collectMissingParamsFromSkillSteps(ir: IntentResultNonNull): string[] {
  const out: string[] = [];
  for (const t of ir.planningTasks ?? []) {
    for (const s of t.skillSteps ?? []) {
      for (const m of s.missingParams ?? []) out.push(m);
    }
  }
  return [...new Set(out)];
}

function collectMissingSlotsFromPlanningTasks(ir: IntentResultNonNull): string[] {
  const out: string[] = [];
  for (const t of ir.planningTasks ?? []) {
    for (const m of t.missingSlots ?? []) out.push(m);
  }
  return [...new Set(out)];
}

function wantsClarification(ir: OrchestratorState["intentResult"]): boolean {
  if (!ir) return false;
  if (ir.needsClarification && ir.clarificationQuestion?.trim()) return true;
  if ((getBestDataQueryIntent(ir)?.missingSlots?.length ?? 0) > 0) return true;
  if ((ir.planningTasks ?? []).some((t) => (t.missingSlots?.length ?? 0) > 0)) return true;
  if (collectMissingParamsFromSkillSteps(ir).length > 0) return true;
  return false;
}

function planClarificationMessageFromPlanningTasks(
  ir: OrchestratorState["intentResult"]
): string | undefined {
  if (!ir?.planningTasks?.length) return undefined;
  const slots = collectMissingSlotsFromPlanningTasks(ir);
  const params = collectMissingParamsFromSkillSteps(ir);
  const merged = [...slots, ...params.filter((p) => !slots.includes(p))];
  if (merged.length > 0) {
    return `请先补充以下信息后再执行：${merged.join("、")}`;
  }
  return ir.clarificationQuestion?.trim() || "当前任务仍需补充必要信息。";
}

function blockedPlanningMessage(ir: OrchestratorState["intentResult"]): string | undefined {
  if (!ir || ir.planPhase !== "blocked") return undefined;
  const missing = (ir.planningTasks ?? [])
    .flatMap((t) => t.missingSlots ?? [])
    .filter((x, i, arr) => arr.indexOf(x) === i);
  const zh =
    ir.clarificationQuestion?.trim() ||
    (missing.length > 0 ? `请补充以下信息后再继续：${missing.join("、")}` : "请先补充必要信息后继续。");
  if (ir.replyLocale === "en") {
    return "Please provide the missing information so I can continue the plan.";
  }
  return zh;
}

function planExecutionPreviewMessage(ir: OrchestratorState["intentResult"]): string | undefined {
  if (!ir?.planningTasks?.length) return undefined;
  if (ir.planPhase === "blocked" || ir.planPhase === "draft") return undefined;
  const executableTasks = ir.planningTasks.filter((t) => t.executable === true);
  if (executableTasks.length === 0) return undefined;
  const lines = executableTasks.slice(0, 3).map((t) => {
    const steps = t.skillSteps ?? [];
    const cap = [...steps]
      .reverse()
      .find((s) => s.selectedSkillId?.trim());
    const entry = cap?.selectedSkillId ? `（${cap.selectedSkillId}）` : "";
    return `${t.taskId}: ${t.goal}${entry}`;
  });
  const more = executableTasks.length > 3 ? `；其余 ${executableTasks.length - 3} 个子任务已省略` : "";
  return `已拆分 ${executableTasks.length} 个可执行子任务：${lines.join("；")}${more}。`;
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
    if (o.type === "task_plan" && typeof o.message === "string") {
      return o.message.slice(0, 2000);
    }
    if (o.type === "plan_blocked" && typeof o.message === "string") {
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

export async function composeAnswerNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  await emitProgressByConfig(config, "正在执行：步骤5 生成最终回复");
  const riKeys = state.resultsIndex ? Object.keys(state.resultsIndex).length : 0;
  log(
    "[Orchestrator]",
    "node compose_answer 开始",
    `dominantIntent=${getDominantIntentFromList(state.intentResult)} intents=${state.intentResult?.intents?.length ?? 0} resultsIndexKeys=${riKeys} clarificationRound=${state.clarificationRound ?? 0}`
  );

  const ir = state.intentResult;
  const dominantIntent = getDominantIntentFromList(ir);
  const dq = getBestDataQueryIntent(ir);
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
    const out = logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: message.slice(0, 2000) }
      ]
    });
    await emitProgressByConfig(config, "步骤5完成：已生成回复");
    return out;
  }

  if (ir?.planPhase === "blocked") {
    const message = blockedPlanningMessage(ir) || "请先补充必要信息后继续。";
    const finalAnswer = {
      type: "plan_blocked" as const,
      message,
      planningTasks: ir.planningTasks ?? []
    };
    return logComposeDone(t0, {
      finalAnswer,
      clarificationRound: round + 1,
      lastClarificationAtMs: Date.now(),
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
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
  if (dq?.missingSlots?.length) {
    const message =
      ir?.clarificationQuestion?.trim() ||
      `请补充以下信息以便查询：${dq.missingSlots.join("、")}`;
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

  /** planningTasks 层缺参（task.missingSlots 或 skillSteps[].missingParams） */
  const planningMissing =
    (ir?.planningTasks?.some((t) => (t.missingSlots?.length ?? 0) > 0) ?? false) ||
    (ir && collectMissingParamsFromSkillSteps(ir).length > 0);
  if (planningMissing && ir) {
    const message =
      ir.clarificationQuestion?.trim() ||
      planClarificationMessageFromPlanningTasks(ir) ||
      "请补充必要信息后继续。";
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
    !!dq
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
    const finalAnswer = dq
      ? {
          type: "data_query" as const,
          resultsIndex: state.resultsIndex
        }
      : {
          type: "task_plan" as const,
          message: Object.values(state.resultsIndex)
            .map((x) => x.summary)
            .slice(0, 3)
            .join("\n"),
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

  if (dominantIntent === "chitchat") {
    const message =
      ir?.replySuggestion?.trim() ||
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

  if (dominantIntent === "unknown") {
    const message =
      ir?.replySuggestion?.trim() ||
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

  if (dominantIntent === "data_analysis") {
    const ia = getBestIntentByType(ir, "data_analysis");
    const message =
      ia?.goal?.trim()
        ? `已识别为数据分析需求：${ia.goal.trim()}。当前版本将先完成查询准备，随后进入分析步骤。`
        : "已识别为数据分析需求。请补充分析口径（指标、时间范围、分组维度）以继续。";
    const finalAnswer = {
      type: "task_plan" as const,
      message,
      planningTasks: ir?.planningTasks ?? []
    };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  if (dominantIntent === "knowledge_qa") {
    const ik = getBestIntentByType(ir, "knowledge_qa");
    const message =
      ik?.goal?.trim()
        ? `已识别为知识问答需求：${ik.goal.trim()}。我会基于已披露能力整理答案。`
        : "已识别为知识问答需求，请补充你希望查询的主题范围或对象。";
    const finalAnswer = {
      type: "task_plan" as const,
      message,
      planningTasks: ir?.planningTasks ?? []
    };
    return logComposeDone(t0, {
      ...clearedClarification,
      finalAnswer,
      conversationTurns: [
        { role: "assistant" as const, content: assistantSnippetFromFinalAnswer(finalAnswer) }
      ]
    });
  }

  if (dq) {
    const preview = planExecutionPreviewMessage(ir);
    const finalAnswer = preview
      ? {
          type: "task_plan" as const,
          message: preview,
          planningTasks: ir?.planningTasks ?? []
        }
      : {
          type: "fallback" as const,
          message: "数据查询未能完成或未返回结果，请换一种说法或稍后再试。"
        };
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
