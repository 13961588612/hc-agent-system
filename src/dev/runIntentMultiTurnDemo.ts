/**
 * 第一期收尾（里程碑 4）自测：同一 thread_id 连续 invoke，验证 checkpoint + conversationTurns。
 *
 * 运行：`npx tsx src/dev/runIntentMultiTurnDemo.ts` 或 `npm run dev:intent-multi`
 *
 * 建议配置 DASHSCOPE_API_KEY：第一轮用模糊问数语料，LLM 可返回 needsClarification；
 * 无 Key 时为关键词兜底，行为以实际语料为准。
 */
import { initCore } from "../bootstrap/initCore.js";
import { runOrchestratorGraph } from "../graph/orchestrator/orchestratorGraph.js";

const THREAD_ID = "demo:intent-multi-turn";
const USER_ID = "demo-user";

async function main() {
  const { env } = await initCore();

  console.log("\n========== 第一轮 ==========\n");
  const r1 = await runOrchestratorGraph(
    {
      userInput: "我想查一下会员信息，但不知道要提供什么",
      userId: USER_ID,
      channel: "cli",
      env
    },
    { configurable: { thread_id: THREAD_ID } }
  );
  console.log("finalAnswer:", JSON.stringify(r1, null, 2));

  console.log("\n========== 第二轮（同 thread_id，模拟用户补充）==========\n");
  const r2 = await runOrchestratorGraph(
    {
      userInput: "手机号是 13800138000",
      userId: USER_ID,
      channel: "cli",
      env
    },
    { configurable: { thread_id: THREAD_ID } }
  );
  console.log("finalAnswer:", JSON.stringify(r2, null, 2));
  console.log(
    "\n[验收提示] 若配置了意图 LLM：第一轮常见为 clarification；第二轮应能结合上文继续分类/查数。"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
