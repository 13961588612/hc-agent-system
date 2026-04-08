import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { hasPlanningBlockers, isPlanningReady } from "./intentSelectors.js";
import { emitProgressByConfig } from "./progressReporter.js";

export async function planGateNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  await emitProgressByConfig(config, "正在执行：步骤2 规划门闸判定");
  const ir = state.intentResult;
  const blocked = hasPlanningBlockers(ir);
  const ready = isPlanningReady(ir);
  log(
    "[Orchestrator]",
    "node plan_gate",
    `planPhase=${ir?.planPhase ?? "none"} blocked=${String(blocked)} ready=${String(ready)} tasks=${ir?.planningTasks?.length ?? 0}`
  );
  await emitProgressByConfig(
    config,
    `步骤2完成：planPhase=${ir?.planPhase ?? "none"}`
  );
  return {};
}
