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
