import type { OrchestratorState } from "../../contracts/schemas.js";

export type IntentItem = OrchestratorState["intentResult"] extends infer R
  ? R extends { intents: infer T }
    ? T extends Array<infer U>
      ? U
      : never
    : never
  : never;

export function getBestDataQueryIntent(
  ir: OrchestratorState["intentResult"]
): IntentItem | undefined {
  if (!ir) return undefined;
  const ready = ir.intents.find(
    (x) => x.intent === "data_query" && (x.missingSlots?.length ?? 0) === 0
  );
  return ready ?? ir.intents.find((x) => x.intent === "data_query");
}

export function getBestIntentByType(
  ir: OrchestratorState["intentResult"],
  target: IntentItem["intent"]
): IntentItem | undefined {
  if (!ir) return undefined;
  return ir.intents.find((x) => x.intent === target);
}

export function getDominantIntentFromList(
  ir: OrchestratorState["intentResult"]
): IntentItem["intent"] | "unknown" {
  if (!ir?.intents?.length) return "unknown";
  const byConfidence = [...ir.intents].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );
  return byConfidence[0]?.intent ?? "unknown";
}

export type PlanningTask = NonNullable<
  NonNullable<OrchestratorState["intentResult"]>["planningTasks"]
>[number];

export function isPlanningReady(ir: OrchestratorState["intentResult"]): boolean {
  return !!ir && ir.planPhase === "ready" && !ir.needsClarification;
}

export function hasPlanningBlockers(ir: OrchestratorState["intentResult"]): boolean {
  if (!ir) return true;
  if (ir.needsClarification) return true;
  if (ir.planPhase === "blocked") return true;
  const tasks = ir.planningTasks ?? [];
  return tasks.some((t) => (t.missingSlots?.length ?? 0) > 0);
}

export function getPlanningTasksByModule(
  ir: OrchestratorState["intentResult"],
  moduleId: string
): PlanningTask[] {
  if (!ir?.planningTasks?.length) return [];
  return ir.planningTasks.filter((t) => t.systemModuleId === moduleId);
}

export function getPrimaryPlanningTask(
  ir: OrchestratorState["intentResult"],
  moduleId: string
): PlanningTask | undefined {
  const tasks = getPlanningTasksByModule(ir, moduleId);
  const executable = tasks.find((t) => t.executable !== false);
  return executable ?? tasks[0];
}
