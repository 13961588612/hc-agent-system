import { runIntentClassifyAgent } from "../../agents/intentClassifyAgent.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";

export async function intentAgentNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  log("[Orchestrator]", "node intent_agent 开始");
  const out = await runIntentClassifyAgent(state);
  log(
    "[Orchestrator]",
    "node intent_agent 结束",
    `primaryIntent=${out.intentResult?.primaryIntent ?? "none"} highLevelDomain=${out.highLevelDomain ?? ""}`,
    t0
  );
  return out;
}
