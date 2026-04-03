import { nanoid } from "nanoid";
import { runDataQueryAgent } from "../../agents/dataQueryAgent.js";
import { writeArtifactInput } from "../../lib/artifacts/fsArtifacts.js";
import type { DataQueryInput, SubTaskEnvelope, SubTaskResult } from "../../contracts/types.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import { getBestDataQueryIntent } from "./intentSelectors.js";

export async function executeDataQueryNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  const ir = state.intentResult;
  const dq = getBestDataQueryIntent(ir);
  if (
    !ir ||
    ir.needsClarification ||
    !dq ||
    (dq.missingSlots?.length ?? 0) > 0
  ) {
    log(
      "[Orchestrator]",
      "node execute_data_query 跳过（守卫）",
      `reason=${!ir ? "no_intentResult" : ir.needsClarification ? "needs_clarification" : dq?.missingSlots?.length ? "missing_slots" : "not_data_query"}`,
      t0
    );
    return {};
  }

  log(
    "[Orchestrator]",
    "node execute_data_query 开始",
    `hasSqlQueries=${Boolean(state.input.sqlQueries?.length)} hasSqlQuery=${Boolean(state.input.sqlQuery?.sql?.trim())} targetIntent=${dq.targetIntent ?? ""} dataQueryDomain=${dq.dataQueryDomain ?? ""}`
  );

  const taskId = nanoid();
  const threadId = config?.configurable?.thread_id ?? `thread-${nanoid()}`;

  const envelope: SubTaskEnvelope<DataQueryInput> = {
    taskId,
    threadId,
    agentType: "data_query",
    goal: "执行数据查询并返回统一 DataQueryResult",
    inputs: (() => {
      const base: DataQueryInput = {
        userInput: state.input.userInput,
        userId: state.input.userId,
        env: state.input.env
      };
      if (state.input.sqlQueries?.length) {
        base.sqlQueries = state.input.sqlQueries;
      } else if (state.input.sqlQuery?.sql?.trim()) {
        base.sqlQuery = state.input.sqlQuery;
      }
      const slots = dq.resolvedSlots;
      if (slots && Object.keys(slots).length > 0) {
        base.resolvedSlots = slots;
      }
      if (dq.targetIntent?.trim()) base.targetIntent = dq.targetIntent.trim();
      if (dq.dataQueryDomain) base.dataQueryDomain = dq.dataQueryDomain;
      return base;
    })(),
    expectedOutputSchema: { name: "DataQueryResult", version: "1.0" }
  };

  await writeArtifactInput(threadId, taskId, envelope);

  const tAgent = Date.now();
  const subResult: SubTaskResult = await runDataQueryAgent(envelope);
  log(
    "[Orchestrator]",
    "runDataQueryAgent 结束",
    `taskId=${taskId} status=${subResult.status}`,
    tAgent
  );

  log(
    "[Orchestrator]",
    "node execute_data_query 结束",
    `taskId=${taskId}`,
    t0
  );

  return {
    resultsIndex: {
      ...(state.resultsIndex ?? {}),
      [taskId]: {
        status: subResult.status,
        summary: subResult.summary,
        artifacts: subResult.artifacts?.map((a) => ({
          id: a.id,
          path: a.path,
          type: a.type
        }))
      }
    }
  };
}
