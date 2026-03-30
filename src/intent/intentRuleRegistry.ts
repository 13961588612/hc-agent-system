import type { IntentRuleEntry } from "./types.js";

const rules = new Map<string, IntentRuleEntry>();

export function clearIntentRules(): void {
  rules.clear();
}

export function registerIntentRule(entry: IntentRuleEntry): void {
  rules.set(entry.id, entry);
}

export function getIntentRule(id: string): IntentRuleEntry | undefined {
  return rules.get(id);
}

export function listIntentRules(): IntentRuleEntry[] {
  return [...rules.values()];
}
