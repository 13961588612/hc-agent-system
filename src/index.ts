import { initCore } from "./bootstrap/initCore.js";
import { loadWeComConfigFromEnv } from "./channels/wecom/wecomEnv.js";
import { startWeComHttpServer } from "./channels/wecom/wecomHttpServer.js";
import { runOrchestratorGraph } from "./graph/orchestrator/orchestratorGraph.js";

async function main() {
  const { env } = await initCore();
  const channelMode = env.channelMode ?? process.env.CHANNEL_MODE ?? "cli";

  if (channelMode === "wecom-http") {
    const wecom = loadWeComConfigFromEnv();
    if (!wecom) {
      console.error(
        "[WeCom] CHANNEL_MODE=wecom-http 但企微配置不完整（需 WECOM_TOKEN、WECOM_ENCODING_AES_KEY、WECOM_CORP_ID）"
      );
      process.exit(1);
    }
    startWeComHttpServer(wecom, env);
    return;
  }

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
