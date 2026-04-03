import { createDbClientManager } from "../lib/infra/dbClientFactory.js";
import { loadEnvConfig, type EnvConfig } from "../config/envConfig.js";
import { loadDatabasesConfig } from "../config/databasesConfig.js";
import {
  getSystemConfig,
  initSystemConfig,
  loadSystemConfigFromFile
} from "../config/systemConfig.js";
import { discoverAndRegisterGuides } from "../lib/guides/scanGuides.js";
import { discoverAndRegisterIntentRules } from "../intent/scanIntentRules.js";
import { getDefaultDbClientManager } from "../lib/infra/dbClientManager.js";

export interface InitCoreResult {
  env: EnvConfig;
}

/**
 * 公共启动：环境变量、数据库连接、SkillGuide 扫描。
 * CLI 与渠道（如企微 HTTP）共用，避免重复初始化。
 */
export async function initCore(): Promise<InitCoreResult> {
  const env = loadEnvConfig();

  const systemLoaded = await loadSystemConfigFromFile();
  initSystemConfig(systemLoaded);
  const sys = getSystemConfig();
  console.log(
    `[System] 域/分段已加载: domains=${sys.domains.length} segments=${sys.segments.length} (version=${sys.version ?? "—"})`
  );

  const dbConfig = await loadDatabasesConfig();
  const dbManager = dbConfig
    ? createDbClientManager(dbConfig)
    : getDefaultDbClientManager();
  console.log(`[Db] 已注册连接: ${dbManager.listNames().join(", ")}`);

  const guidesResult = await discoverAndRegisterGuides();
  if (guidesResult.errors.length > 0) {
    console.warn("[Guides] 扫描提示:", guidesResult.errors);
  }
  console.log(`[Guides] 已加载 SkillGuide: ${guidesResult.discovered} 条`);

  const intentRulesResult = await discoverAndRegisterIntentRules();
  if (intentRulesResult.errors.length > 0) {
    console.warn("[IntentRules] 扫描提示:", intentRulesResult.errors);
  }
  console.log(`[IntentRules] 已加载规则: ${intentRulesResult.discovered} 条`);

  return { env};
}
