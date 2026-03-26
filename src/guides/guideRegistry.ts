import type { SkillGuideEntry } from "./types.js";

const guides = new Map<string, SkillGuideEntry>();

export function registerGuide(entry: SkillGuideEntry): void {
  guides.set(entry.id, entry);
}

export function getGuide(id: string): SkillGuideEntry | undefined {
  return guides.get(id);
}

export function listGuides(): SkillGuideEntry[] {
  return [...guides.values()];
}

export function listGuidesByDomain(domain: string): SkillGuideEntry[] {
  return [...guides.values()].filter((g) => g.domain === domain);
}

export function listGuidesByTag(tag: string): SkillGuideEntry[] {
  return [...guides.values()].filter((g) => g.tags?.includes(tag));
}

export function clearGuides(): void {
  guides.clear();
}
