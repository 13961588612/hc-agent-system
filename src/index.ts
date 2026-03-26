import { loadEnvConfig } from "./config/env.js";
import { runOrchestratorGraph } from "./graph/orchestrator/orchestratorGraph.js";

async function main() {
  const env = loadEnvConfig();

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
