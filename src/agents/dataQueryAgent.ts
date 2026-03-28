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
  const metaErr =
    typeof data.meta?.error === "string" ? (data.meta.error as string) : undefined;
  const rawStepErrors = data.meta?.stepErrors;
  const stepErrors =
    rawStepErrors &&
    typeof rawStepErrors === "object" &&
    !Array.isArray(rawStepErrors)
      ? (rawStepErrors as Record<string, string>)
      : undefined;
  const stepErrorKeys = stepErrors ? Object.keys(stepErrors) : [];
  const hasStepErrors = stepErrorKeys.length > 0;

  let status: "success" | "failed" | "partial" = "success";
  if (metaErr) status = "failed";
  else if (hasStepErrors && rowCount === 0) status = "failed";
  else if (hasStepErrors) status = "partial";

  const summary = metaErr
    ? `数据查询失败：${metaErr}`
    : hasStepErrors && rowCount > 0
      ? `数据查询部分成功：${data.domain} 域，${data.intent}，返回 ${rowCount} 条；失败项：${stepErrorKeys.join(", ")}`
      : hasStepErrors
        ? `数据查询失败：${stepErrorKeys.map((k) => `${k}: ${stepErrors![k]}`).join("; ")}`
        : `数据查询完成：${data.domain} 域，${data.intent}，返回 ${rowCount} 条记录。`;

  const subResult: SubTaskResult<DataQueryResult> = {
    taskId,
    status,
    summary,
    data,
    debug: {
      usedSkills: ["sql-query"],
      timingsMs: {}
    }
  };

  await writeArtifactResult(threadId, taskId, subResult);
  await writeArtifactSummary(threadId, taskId, summary);
  await writeArtifactDebug(threadId, taskId, subResult.debug ?? {});

  return subResult;
}
