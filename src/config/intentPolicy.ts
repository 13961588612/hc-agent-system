/**
 * 意图 / 澄清策略：环境变量可覆盖，缺省为保守值。
 * - MAX_CLARIFICATION_ROUNDS：同一 thread 内允许 assistant 发出「追问」的最多次数
 * - CLARIFICATION_IDLE_MS：距上次追问超过该毫秒则重置追问计数（用户久未回复后再开口）
 * - INTENT_LLM_TIMEOUT_MS：意图分类 LLM 单次调用超时
 * - INTENT_TOOL_MAX_ROUNDS：意图阶段「模型↔工具」最大轮数（每轮至少 1 次 LLM 调用）
 * - INTENT_INVOKE_BODY_MAX_CHARS：意图阶段 invoke_skill 返回的 Guide `body` 最大字符数；0 表示不截断（最慢）
 * - INTENT_LOG_RAW_LLM=1：打印完整 LLM 原始消息（默认仅摘要，减少 I/O）
 */
export function getMaxClarificationRounds(): number {
  const n = Number(process.env.MAX_CLARIFICATION_ROUNDS);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 3;
}

export function getClarificationIdleMs(): number {
  const n = Number(process.env.CLARIFICATION_IDLE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 30 * 60 * 1000;
}

export function getIntentLlmTimeoutMs(): number {
  const n = Number(process.env.INTENT_LLM_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 45_000;
}

/** 意图阶段工具循环上限，避免模型多轮 list/invoke 拖死延迟 */
export function getIntentToolMaxRounds(): number {
  const n = Number(process.env.INTENT_TOOL_MAX_ROUNDS);
  if (Number.isFinite(n) && n >= 1 && n <= 30) return Math.floor(n);
  return 8;
}

/**
 * 意图阶段 invoke_skill 截断 Guide 正文长度（执行阶段 dataQueryGraph 仍拉全文）。
 * 默认 8000；设为 0 表示不截断。
 */
export function getIntentInvokeBodyMaxChars(): number | undefined {
  const n = Number(process.env.INTENT_INVOKE_BODY_MAX_CHARS);
  if (!Number.isFinite(n)) return 8000;
  if (n <= 0) return undefined;
  return Math.min(Math.floor(n), 200_000);
}

export function shouldLogIntentRawLlm(): boolean {
  return (
    process.env.INTENT_LOG_RAW_LLM === "1" || process.env.INTENT_DEBUG === "1"
  );
}
