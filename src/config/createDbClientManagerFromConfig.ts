import type { DbClient } from "../infra/dbClient.js";
import { DummyDbClient } from "../infra/dbClient.js";
import { DbClientManager } from "../infra/dbClientManager.js";
import type { DatabaseConnectionConfig, DatabasesConfigLoaded } from "./loadDatabasesConfig.js";

/**
 * 按配置为每个逻辑名注册 {@link DbClient}。
 * `postgres` / `mysql` / `sqlite` 等在有真实驱动前使用 {@link DummyDbClient} 并打日志，便于联调结构。
 */
function createDbClientForConnection(
  id: string,
  conn: DatabaseConnectionConfig
): DbClient {
  const d = (conn.driver || "dummy").toLowerCase();
  if (d === "dummy") {
    return new DummyDbClient();
  }
  const needsUrl = d === "postgres" || d === "postgresql" || d === "mysql" || d === "sqlite";
  if (needsUrl && !conn.url?.trim()) {
    console.warn(`[DbConfig] "${id}": driver "${d}" 未配置有效 url，使用 DummyDbClient`);
    return new DummyDbClient();
  }
  console.warn(
    `[DbConfig] "${id}": driver "${d}" 尚未接入真实客户端，暂用 DummyDbClient（url 已解析为 ${conn.url ? "已设置" : "无"}）`
  );
  return new DummyDbClient();
}

export function createDbClientManagerFromConfig(
  config: DatabasesConfigLoaded
): DbClientManager {
  const m = new DbClientManager();
  for (const [id, conn] of Object.entries(config.connections)) {
    m.register(id, createDbClientForConnection(id, conn));
  }
  return m;
}
