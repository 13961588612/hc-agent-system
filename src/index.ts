import { createDbClientManagerFromConfig } from "./config/createDbClientManagerFromConfig.js";
import { initDbClientManager } from "./config/dbAppContext.js";
import { loadEnvConfig } from "./config/env.js";
import { loadDatabasesConfig } from "./config/loadDatabasesConfig.js";
import { discoverAndRegisterGuides } from "./guides/scanGuides.js";
import { runOrchestratorGraph } from "./graph/orchestrator/orchestratorGraph.js";
import { createDefaultDbClientManager } from "./infra/dbClientManager.js";

async function main() {
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

  const result = await runOrchestratorGraph(
    {
      userInput: "帮我查一下我最近的订单",
      userId: "demo-user",
      channel: "cli",
      env
    },
    { configurable: { thread_id: "demo-user:session-1" } }
  );

  console.log("Graph result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
