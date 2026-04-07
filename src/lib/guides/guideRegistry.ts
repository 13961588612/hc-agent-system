import type { SkillGuideEntry } from "./types.js";

const guides = new Map<string, SkillGuideEntry>();

function guideMatchesQueryKey(g: SkillGuideEntry, q: string): boolean {
  if (g.id === q) return true;
  return false;
}

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

/** 按 `id` 查找 Guide。 */
export function getGuideById(guideId: string): SkillGuideEntry | undefined {
  const q = guideId.trim();
  if (!q) return undefined;
  for (const g of guides.values()) {
    if (guideMatchesQueryKey(g, q)) return g;
  }
  return undefined;
}

/** 解析键到 Guide：当前仅支持 `id`。 */
export function findGuideByKey(
  key: string
): { guide: SkillGuideEntry } | undefined {
  const q = key.trim();
  if (!q) return undefined;
  for (const g of guides.values()) {
    if (guideMatchesQueryKey(g, q)) return { guide: g };
  }
  return undefined;
}

export function clearGuides(): void {
  guides.clear();
}
