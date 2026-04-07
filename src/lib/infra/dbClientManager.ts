import { DatabaseConnectionConfig, DatabasesConfig } from "../../config/databasesConfig.js";
import type { DbClient } from "./dbClient.js";
import { DummyDbClient } from "./dbClient.js";
import { createDbClientForConnection } from "./dbClientFactory.js";

/**
 * 按名称管理多个 {@link DbClient}（多数据源 / 多租户 / 读写分离等）。
 * 未命中注册名时由调用方决定策略；`tryGet` 不抛错。
 */
export class DbClientManager {
  private readonly clients = new Map<string, DbClient>();

  /** 注册或覆盖某一名称下的客户端 */
  register(name: string, client: DbClient): void {
    this.clients.set(name, client);
  }

  /** 移除指定名称，返回是否曾存在 */
  unregister(name: string): boolean {
    return this.clients.delete(name);
  }

  /** 必须存在，否则抛错 */
  get(name: string): DbClient {
    const c = this.clients.get(name);
    if (!c) {
      throw new Error(`DbClientManager: no client registered for "${name}"`);
    }
    return c;
  }

  /** 不存在则返回 `undefined` */
  tryGet(name: string): DbClient | undefined {
    return this.clients.get(name);
  }

  listNames(): string[] {
    return [...this.clients.keys()];
  }

  clear(): void {
    this.clients.clear();
  }
}

export let dbClientManager: DbClientManager | null = null;

/**
 * 带 `default` 键的 {@link DummyDbClient}，与阶段一 Demo 行为一致。
 */
export function getDefaultDbClientManager(): DbClientManager {
  if (!dbClientManager) {
    throw new Error("DbClientManager not initialized");
  }
  return dbClientManager;
}


export function createDbClientManager(config: DatabasesConfig): DbClientManager {
  const m = new DbClientManager();
  for (const [id, conn] of Object.entries(config.connections)) {
    m.register(id, createDbClientForConnection(id, conn as DatabaseConnectionConfig));
  }
  dbClientManager = m;
  return m;
}
