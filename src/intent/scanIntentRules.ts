import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { getSegmentEntry, getSystemConfig } from "../config/systemConfig.js";
import {
  clearIntentRules,
  getIntentRule,
  registerIntentRule
} from "./intentRuleRegistry.js";
import type { IntentRuleDomain, IntentRuleEntry } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function defaultIntentRulesDir(): string {
  return join(process.cwd(), "skills", "intent");
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
    if (e.isDirectory()) out.push(...(await collectMdFiles(p)));
    else if (e.isFile() && extname(name).toLowerCase() === ".md") {
      if (basename(name).toUpperCase() === "README.MD") continue;
      out.push(p);
    }
  }
  return out;
}

function parseIntentRule(content: string, filePath: string): IntentRuleEntry | null {
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
  if (o.kind !== "intent_rule") return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const targetIntent =
    typeof o.targetIntent === "string" ? o.targetIntent.trim() : "";
  if (!id || !title || !targetIntent) return null;
  let domain: IntentRuleDomain | undefined;
  if (typeof o.domain === "string") {
    const d = o.domain.trim();
    if (d) {
      if (getSegmentEntry(d, getSystemConfig())) domain = d;
      else
        console.warn(
          `[IntentRules] ${filePath}: domain "${d}" 未在 system segments 中注册，已忽略`
        );
    }
  }
  return {
    id,
    kind: "intent_rule",
    title,
    domain,
    targetIntent,
    triggerKeywords: Array.isArray(o.triggerKeywords)
      ? o.triggerKeywords.filter((x): x is string => typeof x === "string")
      : undefined,
    triggerRegex: Array.isArray(o.triggerRegex)
      ? o.triggerRegex.filter((x): x is string => typeof x === "string")
      : undefined,
    requiredSlots: Array.isArray(o.requiredSlots)
      ? o.requiredSlots.filter((x): x is string => typeof x === "string")
      : undefined,
    slotExtractors: Array.isArray(o.slotExtractors)
      ? o.slotExtractors
          .map((x) => {
            if (!x || typeof x !== "object") return null;
            const r = x as Record<string, unknown>;
            const slot = typeof r.slot === "string" ? r.slot.trim() : "";
            const regex = typeof r.regex === "string" ? r.regex.trim() : "";
            if (!slot || !regex) return null;
            return { slot, regex };
          })
          .filter((x): x is { slot: string; regex: string } => x != null)
      : undefined,
    clarificationTemplate:
      typeof o.clarificationTemplate === "string"
        ? o.clarificationTemplate
        : undefined,
    priority: typeof o.priority === "number" ? o.priority : undefined,
    filePath
  };
}

export async function discoverAndRegisterIntentRules(
  baseDir: string = defaultIntentRulesDir()
): Promise<{ discovered: number; errors: string[] }> {
  clearIntentRules();
  const errors: string[] = [];
  let discovered = 0;
  const files = await collectMdFiles(baseDir);
  for (const file of files) {
    let raw = "";
    try {
      raw = await readFile(file, "utf-8");
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
      continue;
    }
    const entry = parseIntentRule(raw, file);
    if (!entry) {
      errors.push(`${file}: 跳过（无 frontmatter、非 kind:intent_rule 或缺 id/targetIntent/title）`);
      continue;
    }
    if (getIntentRule(entry.id)) {
      errors.push(`${file}: id 重复 "${entry.id}"，已忽略后出现的文件`);
      continue;
    }
    registerIntentRule(entry);
    discovered++;
  }
  return { discovered, errors };
}
