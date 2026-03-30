/**
 * 意图 / 澄清策略：环境变量可覆盖，缺省为保守值。
 * - MAX_CLARIFICATION_ROUNDS：同一 thread 内允许 assistant 发出「追问」的最多次数
 * - CLARIFICATION_IDLE_MS：距上次追问超过该毫秒则重置追问计数（用户久未回复后再开口）
 * - INTENT_LLM_TIMEOUT_MS：意图分类 LLM 单次调用超时
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
