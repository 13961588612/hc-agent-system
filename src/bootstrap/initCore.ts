import { createDbClientManager } from "../lib/infra/dbClientManager.js";
import { loadEnvConfig, type EnvConfig } from "../config/envConfig.js";
import { loadDatabasesConfig } from "../config/databasesConfig.js";
import {
  getSystemConfig,
  loadSystemConfigFromFile
} from "../config/systemConfig.js";
import {
  initChannelReplyConfig,
  loadChannelReplyConfigFromFile
} from "../config/channelReplyConfig.js";
import { refreshIntentResultSchemaCache } from "../contracts/intentSchemas.js";
import { refreshSystemSchemaCache } from "../contracts/SystemSchema.js";
import { refreshIntentSeparateSchemaCache } from "../intent/separate/intentSeparateSchema.js";
import { getRuntimeContext } from "../config/runtimeContext.js";
import { defaultGuidesDir, discoverAndRegisterGuides } from "../lib/guides/scanGuides.js";
import { discoverAndRegisterIntentRules } from "../intent/rule/scanIntentRules.js";
import type { DatabasesConfig } from "../config/databasesConfig.js";

export interface InitCoreResult {
  env: EnvConfig;
}

/**
 * 公共启动：环境变量、数据库连接、SkillGuide 扫描。
 * CLI 与渠道（如企微 HTTP）共用，避免重复初始化。
 */
export async function initCore(): Promise<InitCoreResult> {
  const env = loadEnvConfig();

  const rt = getRuntimeContext();
  console.log(
    `[Runtime] workspaceDir=${rt.workspaceDir}` +
      (rt.gitRootDir ? ` gitRootDir=${rt.gitRootDir}` : "")
  );

  await loadSystemConfigFromFile();
  initChannelReplyConfig(await loadChannelReplyConfigFromFile());
  const sys = await getSystemConfig();
  refreshIntentResultSchemaCache(sys);
  refreshSystemSchemaCache(sys);
  refreshIntentSeparateSchemaCache(sys);
  console.log(
    `[System] 意图/域已加载: intentions=${sys.intentions.length} domains=${sys.domains.length} (version=${sys.version ?? "—"})`
  );
  if (sys.intentions.length === 0 && sys.domains.length === 0) {
    console.warn(
      "[System] 当前无有效 system 配置（请放置 config/system.yaml 或设置 SYSTEM_CONFIG 指向有效文件）"
    );
  }

  const dbConfig = await loadDatabasesConfig();
  const effectiveDbConfig: DatabasesConfig =
    dbConfig ??
    {
      connections: {
        default: { driver: "dummy" }
      }
    };
  const dbManager = createDbClientManager(effectiveDbConfig);
  console.log(`[Db] 已注册连接: ${dbManager.listNames().join(", ")}`);

  const guidesDir = defaultGuidesDir();
  console.log(`[Guides] 扫描目录: ${guidesDir}`);
  const guidesResult = await discoverAndRegisterGuides(guidesDir);
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
