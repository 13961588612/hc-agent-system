import type { GuideCapabilityMeta, SkillGuideEntry } from "./types.js";

const guides = new Map<string, SkillGuideEntry>();

function guideMatchesQueryKey(g: SkillGuideEntry, q: string): boolean {
  if (g.queryTemplateId === q) return true;
  for (const c of g.capabilities ?? []) {
    if (c.id === q || c.queryTemplateId === q) return true;
  }
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

/**
 * 按 `queryTemplateId`、或某条能力的 `id` / `queryTemplateId` 查找 Guide；
 * 若多条相同键，以**先注册者**为准（扫描顺序）。
 */
export function getGuideByQueryTemplateId(
  queryTemplateId: string
): SkillGuideEntry | undefined {
  const q = queryTemplateId.trim();
  if (!q) return undefined;
  for (const g of guides.values()) {
    if (guideMatchesQueryKey(g, q)) return g;
  }
  return undefined;
}

/**
 * 解析键到「Guide + 可选能力」：键可为文件级 `queryTemplateId`，或 `capabilities[].id` / `capabilities[].queryTemplateId`。
 * 仅命中文件级 `queryTemplateId` 时 `capability` 为 `undefined`（宜用顶层 `params` / `execution`）。
 */
export function findGuideCapabilityByKey(
  key: string
):
  | { guide: SkillGuideEntry; capability: GuideCapabilityMeta | undefined }
  | undefined {
  const q = key.trim();
  if (!q) return undefined;
  for (const g of guides.values()) {
    if (g.queryTemplateId === q) return { guide: g, capability: undefined };
    for (const c of g.capabilities ?? []) {
      if (c.id === q || c.queryTemplateId === q)
        return { guide: g, capability: c };
    }
  }
  return undefined;
}

export function clearGuides(): void {
  guides.clear();
}
