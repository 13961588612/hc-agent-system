/** 将编排 `finalAnswer` 转为可发送的文本（企微单条有长度限制，发送处再截断） */
export function formatFinalAnswerForChannel(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (o.type === "fallback" && typeof o.message === "string") return o.message;
    if (o.type === "clarification" && typeof o.message === "string") return o.message;
    if (o.type === "chitchat" && typeof o.message === "string") return o.message;
    if (o.type === "task_plan" && typeof o.message === "string") return o.message;
    if (o.type === "plan_blocked" && typeof o.message === "string") return o.message;
    if (o.type === "data_query") return JSON.stringify(result, null, 2);
  }
  return JSON.stringify(result, null, 2);
}
