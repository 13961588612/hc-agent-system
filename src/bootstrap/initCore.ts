import { createDbClientManagerFromConfig } from "../config/createDbClientManagerFromConfig.js";
import { initDbClientManager } from "../config/dbAppContext.js";
import { loadEnvConfig, type EnvConfig } from "../config/env.js";
import { loadDatabasesConfig } from "../config/loadDatabasesConfig.js";
import { discoverAndRegisterGuides } from "../guides/scanGuides.js";
import { createDefaultDbClientManager } from "../infra/dbClientManager.js";

export interface InitCoreResult {
  env: EnvConfig;
}

/**
 * 公共启动：环境变量、数据库连接、SkillGuide 扫描。
 * CLI 与渠道（如企微 HTTP）共用，避免重复初始化。
 */
export async function initCore(): Promise<InitCoreResult> {
  const env = loadEnvConfig();

  const dbConfig = await loadDatabasesConfig();
  const dbManager = dbConfig
    ? createDbClientManagerFromConfig(dbConfig)
    : createDefaultDbClientManager();
  initDbClientManager(dbManager);
  console.log(`[Db] 已注册连接: ${dbManager.listNames().join(", ")}`);

  const guidesResult = await discoverAndRegisterGuides();
  if (guidesResult.errors.length > 0) {
    console.warn("[Guides] 扫描提示:", guidesResult.errors);
  }
  console.log(`[Guides] 已加载 SkillGuide: ${guidesResult.discovered} 条`);

  return { env };
}
