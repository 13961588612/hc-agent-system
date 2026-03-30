import { runIntentClassifyAgent } from "../../agents/intentClassifyAgent.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { logDebugStep } from "../../infra/debugLog.js";

export async function intentAgentNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  logDebugStep("[Orchestrator]", "node intent_agent 开始");
  const out = await runIntentClassifyAgent(state);
  logDebugStep(
    "[Orchestrator]",
    "node intent_agent 结束",
    `primaryIntent=${out.intentResult?.primaryIntent ?? "none"} highLevelDomain=${out.highLevelDomain ?? ""}`,
    t0
  );
  return out;
}
