import { initCore } from "./bootstrap/initCore.js";
import { startWeComLongConnection } from "./channels/wecom/wecomLongConnection.js";
import { startWeComHttpServer } from "./channels/wecom/wecomHttpServer.js";
import { loadWeComConfig, type WeComChannelConfig } from "./channels/wecom/wecomConfig.js";
import { loadChannelsConfig, type ChannelsConfig } from "./config/channelsConfig.js";
import { runOrchestratorGraph } from "./graph/orchestrator/orchestratorGraph.js";

function isWecomChannelMode(mode: string): boolean {
  return mode === "wecom" || mode === "wecom-http" || mode === "wecom-long";
}

async function main() {
  const { env } = await initCore();
  const channelsConfig = await loadChannelsConfig() as ChannelsConfig;
  const channelMode = env.channelMode ?? "cli";

  if (isWecomChannelMode(channelMode)) {
    const wecomConfig = loadWeComConfig(channelsConfig ?? {}) as WeComChannelConfig;
    const transport = channelsConfig?.wecom?.transport ?? "long_connection";

    if (transport === "http_callback") {
      const httpCfg = wecomConfig?.http;
      if (!httpCfg) {
        console.error(
          "[WeCom] HTTP 回调模式需要环境变量：WECOM_TOKEN、WECOM_ENCODING_AES_KEY、WECOM_CORP_ID"
        );
        process.exit(1);
      }
      startWeComHttpServer(wecomConfig, env);
      return;
    }

    const longCfg = wecomConfig?.longConnection;
    if (!longCfg) {
      console.error("[WeCom] 长连接模式需要环境变量：WECOM_BOT_ID、WECOM_BOT_SECRET");
      process.exit(1);
    }
    startWeComLongConnection(wecomConfig, env);
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
