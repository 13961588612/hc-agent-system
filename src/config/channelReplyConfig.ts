import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ChannelReplyConfig {
  table?: {
    maxRows?: number;
    maxColumns?: number;
    headerZhMap?: Record<string, string>;
  };
}

const EMPTY_CHANNEL_REPLY_CONFIG: ChannelReplyConfig = Object.freeze({
  table: Object.freeze({
    maxRows: 20,
    maxColumns: 8,
    headerZhMap: Object.freeze({}) as Record<string, string>
  })
});

let singleton: ChannelReplyConfig = EMPTY_CHANNEL_REPLY_CONFIG;

function normalizePositiveInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return n > 0 ? n : undefined;
}

function parseRoot(parsed: unknown): ChannelReplyConfig | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const tableRaw = root.table && typeof root.table === "object"
    ? (root.table as Record<string, unknown>)
    : undefined;
  const maxRows = normalizePositiveInt(tableRaw?.maxRows);
  const maxColumns = normalizePositiveInt(tableRaw?.maxColumns);
  const headerZhMap: Record<string, string> = {};
  if (tableRaw?.headerZhMap && typeof tableRaw.headerZhMap === "object") {
    const rawMap = tableRaw.headerZhMap as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawMap)) {
      const key = k.trim();
      const val = typeof v === "string" ? v.trim() : "";
      if (!key || !val) continue;
      headerZhMap[key] = val;
    }
  }
  return {
    table: {
      maxRows,
      maxColumns,
      headerZhMap
    }
  };
}

export async function loadChannelReplyConfigFromFile(): Promise<ChannelReplyConfig | null> {
  const path =
    process.env.CHANNEL_REPLY_CONFIG?.trim() ||
    join(process.cwd(), "config", "channel-reply.yaml");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    console.warn("[ChannelReplyConfig] YAML 解析失败:", path);
    return null;
  }
  return parseRoot(parsed);
}

export function initChannelReplyConfig(loaded: ChannelReplyConfig | null): void {
  singleton = loaded ?? EMPTY_CHANNEL_REPLY_CONFIG;
}

export function getChannelReplyConfig(): ChannelReplyConfig {
  return singleton;
}
