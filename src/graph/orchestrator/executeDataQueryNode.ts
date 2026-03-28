import { nanoid } from "nanoid";
import { runDataQueryAgent } from "../../agents/dataQueryAgent.js";
import { writeArtifactInput } from "../../artifacts/fsArtifacts.js";
import type { DataQueryInput, SubTaskEnvelope, SubTaskResult } from "../../contracts/types.js";
import type { OrchestratorState } from "../../contracts/schemas.js";

export async function executeDataQueryNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  if (state.highLevelDomain !== "data_query") {
    return state;
  }

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
      return base;
    })(),
    expectedOutputSchema: { name: "DataQueryResult", version: "1.0" }
  };

  await writeArtifactInput(threadId, taskId, envelope);

  const subResult: SubTaskResult = await runDataQueryAgent(envelope);

  return {
    ...state,
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
