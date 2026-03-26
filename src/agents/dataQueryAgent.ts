import {
  writeArtifactInput,
  writeArtifactResult,
  writeArtifactSummary,
  writeArtifactDebug
} from "../artifacts/fsArtifacts.js";
import { runDataQueryGraph } from "../graph/data-query/dataQueryGraph.js";
import type {
  DataQueryInput,
  DataQueryResult,
  SubTaskEnvelope,
  SubTaskResult
} from "../contracts/types.js";

export async function runDataQueryAgent(
  envelope: SubTaskEnvelope<DataQueryInput>
): Promise<SubTaskResult<DataQueryResult>> {
  const { taskId, threadId, inputs } = envelope;

  await writeArtifactInput(threadId, taskId, envelope);

  const data = await runDataQueryGraph(inputs);

  const rowCount =
    data.dataType === "tables" && data.tables
      ? data.tables.reduce((sum, t) => sum + t.rows.length, 0)
      : data.rows.length;
  const summary = `数据查询完成：${data.domain} 域，${data.intent}，返回 ${rowCount} 条记录。`;
  const subResult: SubTaskResult<DataQueryResult> = {
    taskId,
    status: "success",
    summary,
    data,
    debug: {
      usedSkills: ["sqlQuerySkill"],
      timingsMs: {}
    }
  };

  await writeArtifactResult(threadId, taskId, subResult);
    await writeArtifactSummary(threadId, taskId, summary);
  await writeArtifactDebug(threadId, taskId, subResult.debug ?? {});

  return subResult;
}
