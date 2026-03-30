import type { OrchestratorInput } from "../contracts/types.js";
import { runOrchestratorGraph } from "../graph/orchestrator/orchestratorGraph.js";

/**
 * Supervisor：主图编排入口（意图 → Guide → 问数 → 合成）。
 * 调用前须先执行 `initCore()`，以完成数据库与 SkillGuide 扫描。
 */
export async function runSupervisorAgent(
  input: OrchestratorInput,
  config?: { configurable?: { thread_id?: string } }
): Promise<unknown> {
  return runOrchestratorGraph(input, config);
}
