import type { GuideEntry } from "./types.js";

const guides = new Map<string, GuideEntry>();

function guideMatchesQueryKey(g: GuideEntry, q: string): boolean {
  if (g.id === q) return true;
  return false;
}

export function registerGuide(entry: GuideEntry): void {
  guides.set(entry.id, entry);
}

export function getGuide(id: string): GuideEntry | undefined {
  return guides.get(id);
}

export function listGuides(): GuideEntry[] {
  return [...guides.values()];
}

export function listGuidesByDomainId(domainId: string): GuideEntry[] {
  return [...guides.values()].filter((g) => g.domainId === domainId);
}

export function listGuidesByTag(tag: string): GuideEntry[] {
  return [...guides.values()].filter((g) => g.tags?.includes(tag));
}

/** 按 `id` 查找 Guide。 */
export function getGuideById(guideId: string): GuideEntry | undefined {
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
): { guide: GuideEntry } | undefined {
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
