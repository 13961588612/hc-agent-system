import type { DbClientManager } from "../infra/dbClientManager.js";

let manager: DbClientManager | null = null;

export function initDbClientManager(m: DbClientManager): void {
  manager = m;
}

export function getDbClientManager(): DbClientManager {
  if (!manager) {
    throw new Error("DbClientManager 未初始化：请在启动时调用 initDbClientManager");
  }
  return manager;
}

export function tryGetDbClientManager(): DbClientManager | undefined {
  return manager ?? undefined;
}
