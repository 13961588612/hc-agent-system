import type { DbClient } from "./dbClient.js";
import { DummyDbClient } from "./dummyDbClient.js";
import { MysqlDbClient } from "./mysqlDbClient.js";
import { OracleDbClient } from "./oracleDbClient.js";
import { DbClientManager } from "./dbClientManager.js";
import type { DatabaseConnectionConfig, DatabasesConfig } from "../config/databasesConfig.js";

/**
 * 按配置为每个逻辑名注册 {@link DbClient}。
 * 已接入：`mysql`、`oracle`；`postgres` / `sqlite` 等仍回退 {@link DummyDbClient}。
 */
function createDbClientForConnection(id: string, conn: DatabaseConnectionConfig): DbClient {
  const d = (conn.driver || "dummy").toLowerCase();
  if (d === "dummy") {
    return new DummyDbClient();
  }

  const needsUrl =
    d === "postgres" ||
    d === "postgresql" ||
    d === "mysql" ||
    d === "sqlite" ||
    d === "oracle";
  if (needsUrl && !conn.url?.trim()) {
    console.warn(`[DbConfig] "${id}": driver "${d}" 未配置有效 url，使用 DummyDbClient`);
    return new DummyDbClient();
  }

  if (d === "mysql") {
    try {
      return new MysqlDbClient(conn.url);
    } catch (e) {
      console.error(`[DbConfig] "${id}": MysqlDbClient 创建失败`, e);
      return new DummyDbClient();
    }
  }

  if (d === "oracle") {
    try {
      return new OracleDbClient(conn.url);
    } catch (e) {
      console.error(`[DbConfig] "${id}": OracleDbClient 创建失败`, e);
      return new DummyDbClient();
    }
  }

  if (d === "postgres" || d === "postgresql" || d === "sqlite") {
    console.warn(
      `[DbConfig] "${id}": driver "${d}" 尚未接入真实客户端，暂用 DummyDbClient（url 已解析为 ${conn.url ? "已设置" : "无"}）`
    );
    return new DummyDbClient();
  }

  console.warn(`[DbConfig] "${id}": 未知 driver "${d}"，使用 DummyDbClient`);
  return new DummyDbClient();
}

export function createDbClientManager(config: DatabasesConfig): DbClientManager {
  const m = new DbClientManager();
  for (const [id, conn] of Object.entries(config.connections)) {
    m.register(id, createDbClientForConnection(id, conn as DatabaseConnectionConfig));
  }
  return m;
}
