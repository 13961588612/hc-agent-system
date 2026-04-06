import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { hasPlanningBlockers, isPlanningReady } from "./intentSelectors.js";

export function planGateNode(state: OrchestratorState): Partial<OrchestratorState> {
  const ir = state.intentResult;
  const blocked = hasPlanningBlockers(ir);
  const ready = isPlanningReady(ir);
  log(
    "[Orchestrator]",
    "node plan_gate",
    `planPhase=${ir?.planPhase ?? "none"} blocked=${String(blocked)} ready=${String(ready)} tasks=${ir?.planningTasks?.length ?? 0}`
  );
  return {};
}
