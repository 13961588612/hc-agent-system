import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { clearGuides, getGuide, registerGuide } from "./guideRegistry.js";
import {
  parseCapabilitiesBlock,
  parseExecutionBlock,
  parseParamsBlock
} from "./parseGuideMeta.js";
import type { SkillGuideEntry } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** 默认：`<cwd>/skills/guides`；可通过环境变量 `GUIDES_DIR` 覆盖 */
export function defaultGuidesDir(): string {
  const fromEnv = process.env.GUIDES_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), "skills", "guides");
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const name = String(e.name);
    const p = join(dir, name);
    if (e.isDirectory()) {
      out.push(...(await collectMdFiles(p)));
    } else if (e.isFile() && extname(name).toLowerCase() === ".md") {
      if (basename(name).toUpperCase() === "README.MD") continue;
      out.push(p);
    }
  }
  return out;
}

function parseGuideFile(content: string, filePath: string): SkillGuideEntry | null {
  const m = content.match(FRONTMATTER);
  if (!m) return null;
  let meta: unknown;
  try {
    meta = parseYaml(m[1]);
  } catch {
    return null;
  }
  if (!meta || typeof meta !== "object") return null;
  const o = meta as Record<string, unknown>;
  if (o.kind !== "guide") return null;
  const id = typeof o.id === "string" ? o.id : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!id || !title) return null;

  const queryTemplateId =
    typeof o.queryTemplateId === "string" ? o.queryTemplateId.trim() : undefined;
  const description =
    typeof o.description === "string" ? o.description.trim() : undefined;
  const params = parseParamsBlock(o.params);
  const execution = parseExecutionBlock(o.execution);
  const capabilities = parseCapabilitiesBlock(o.capabilities);

  const entry: SkillGuideEntry = {
    id,
    kind: "guide",
    title,
    ...(description ? { description } : {}),
    domain: typeof o.domain === "string" ? o.domain : undefined,
    segment: typeof o.segment === "string" ? o.segment : undefined,
    relatedSkillIds: Array.isArray(o.relatedSkillIds)
      ? o.relatedSkillIds.filter((x): x is string => typeof x === "string")
      : undefined,
    tags: Array.isArray(o.tags)
      ? o.tags.filter((x): x is string => typeof x === "string")
      : undefined,
    ...(queryTemplateId ? { queryTemplateId } : {}),
    ...(params ? { params } : {}),
    ...(execution ? { execution } : {}),
    ...(capabilities ? { capabilities } : {}),
    body: m[2].trim(),
    filePath
  };
  return entry;
}

/**
 * 扫描目录下所有 `.md`（含子目录，跳过 `README.md`），解析 frontmatter 且 `kind: guide` 的条目并注册。
 */
export async function discoverAndRegisterGuides(
  baseDir: string = defaultGuidesDir()
): Promise<{ discovered: number; errors: string[] }> {
  clearGuides();
  const errors: string[] = [];
  let discovered = 0;
  const files = await collectMdFiles(baseDir);
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
      continue;
    }
    const entry = parseGuideFile(raw, file);
    if (!entry) {
      errors.push(`${file}: 跳过（无 frontmatter、非 kind: guide 或缺少 id/title）`);
      continue;
    }
    if (getGuide(entry.id)) {
      errors.push(`${file}: id 重复 "${entry.id}"，已忽略后出现的文件`);
      continue;
    }
    registerGuide(entry);
    discovered++;
  }
  return { discovered, errors };
}
