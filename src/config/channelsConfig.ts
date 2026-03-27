import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { substituteEnvInString } from "./envSubstitute.js";

/** 对指定键的字符串值做 `${VAR}` → `process.env` 展开 */
function applyEnvSubstToStrings(obj: Record<string, unknown>, keys: readonly string[]): void {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") {
      obj[k] = substituteEnvInString(v);
    }
  }
}

function substituteEnvInPort(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const s = substituteEnvInString(value);
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 与 `config/channels.example.yaml` 中 `wecom.transport` 一致 */
export type WeComTransport = "http_callback" | "long_connection";

export interface ChannelsConfig {
  wecom?: {
    enabled?: boolean;
    transport?: WeComTransport;
    corpId?: string;
    corpSecret?: string;
    http?: {
      enabled?: boolean;
      callbackPath?: string;
      plaintextMode?: boolean;
      token?: string;
      agentId?: string;
      encodingAESKey?: string;
      webhookKey?: string;
      port?: number;
    };
    longConnection?: {
      enabled?: boolean;
      botId?: string;
      botSecret?: string;      
      wsUrl?: string;
    };
  };
}

/**
 * 读取 `CHANNELS_CONFIG` 指向的文件，或默认 `<cwd>/config/channels.yaml`。
 * 文件不存在或解析失败时返回 `null`。
 */
export async function loadChannelsConfig(): Promise<ChannelsConfig | null> {
  const path =
    process.env.CHANNELS_CONFIG?.trim() || join(process.cwd(), "config", "channels.yaml");
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
    console.warn("[Channels] YAML 解析失败:", path);
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const wecom = root.wecom;
  if (!wecom || typeof wecom !== "object") return {};
  const w = wecom as Record<string, unknown>;
  const transportRaw = w.transport;
  let transport: WeComTransport | undefined;
  if (transportRaw === "http_callback" || transportRaw === "long_connection") {
    transport = transportRaw;
  }
  let w_http: Record<string, unknown> | undefined = w.http as Record<string, unknown>;
  let w_longConnection: Record<string, unknown> | undefined = w.longConnection as Record<string, unknown>;
  if (w_http) {
    w_http.enabled = w_http.enabled as boolean;
    w_http.plaintextMode = w_http.plaintextMode as boolean;
    applyEnvSubstToStrings(w_http, [
      "callbackPath",
      "token",
      "agentId",
      "encodingAESKey",
      "webhookKey"
    ]);
    const portN = substituteEnvInPort(w_http.port);
    if (portN !== undefined) {
      w_http.port = portN;
    }
  }
  if (w_longConnection) {
    w_longConnection.enabled = w_longConnection.enabled as boolean;
    applyEnvSubstToStrings(w_longConnection, ["botId", "botSecret"]);
  }

  applyEnvSubstToStrings(w, ["corpId", "corpSecret"]);

  return { wecom: { enabled: typeof w.enabled === "boolean" ? w.enabled : undefined, transport, http: w_http, longConnection: w_longConnection } };
}
