import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initCore } from "../bootstrap/initCore.js";
import { runOrchestratorGraph } from "../graph/orchestrator/orchestratorGraph.js";

const THREAD_ID = "demo:cli-chat";
const USER_ID = "cli-user";

async function main() {
  const { env } = await initCore();
  const rl = createInterface({ input, output });

  console.log("本地对话调试已启动。输入 /exit 退出，输入 /reset 重置会话。");
  let threadId = THREAD_ID;

  try {
    while (true) {
      const text = (await rl.question("你> ")).trim();
      if (!text) continue;
      if (text === "/exit") break;
      if (text === "/reset") {
        threadId = `${THREAD_ID}:${Date.now()}`;
        console.log("会话已重置。");
        continue;
      }

      const finalAnswer = await runOrchestratorGraph(
        {
          userInput: text,
          userId: USER_ID,
          channel: "cli",
          env
        },
        { configurable: { thread_id: threadId } }
      );

      if (typeof finalAnswer === "string") {
        console.log(`助手> ${finalAnswer}`);
      } else {
        console.log(`助手> ${JSON.stringify(finalAnswer, null, 2)}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
