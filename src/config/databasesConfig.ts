import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { substituteEnvInString } from "./envSubstitute.js";

/** 兼容旧引用：与 `envSubstitute.substituteEnvInString` 相同 */
export { substituteEnvInString };

export interface DatabaseConnectionConfig {
  driver: string;
  url?: string;
  readOnly?: boolean;
}

export interface DatabasesConfig {
  connections: Record<string, DatabaseConnectionConfig>;
}

function normalizeConnection(raw: unknown): DatabaseConnectionConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const driver = typeof row.driver === "string" ? row.driver : "dummy";
  const urlRaw = typeof row.url === "string" ? substituteEnvInString(row.url) : undefined;
  const url = urlRaw === "" ? undefined : urlRaw;
  return {
    driver,
    url,
    readOnly: typeof row.readOnly === "boolean" ? row.readOnly : undefined
  };
}

/**
 * 读取 `DATABASES_CONFIG` 指向的文件，或默认 `<cwd>/config/databases.yaml`。
 * 文件不存在或无效时返回 `null`（由调用方回退到内置默认连接）。
 */
export async function loadDatabasesConfig(): Promise<DatabasesConfig | null> {
  const path =
    process.env.DATABASES_CONFIG?.trim() || join(process.cwd(), "config", "databases.yaml");
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
    console.warn("[DbConfig] YAML 解析失败:", path);
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const conns = o.connections;
  if (!conns || typeof conns !== "object") return null;
  const connections: Record<string, DatabaseConnectionConfig> = {};
  for (const [k, v] of Object.entries(conns as Record<string, unknown>)) {
    const c = normalizeConnection(v);
    if (c) connections[k] = c;
  }
  if (Object.keys(connections).length === 0) return null;
  return { connections };
}
