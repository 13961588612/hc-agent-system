import { nanoid } from "nanoid";
import { runDataQueryAgent } from "../../agents/dataQueryAgent.js";
import { writeArtifactInput } from "../../lib/artifacts/fsArtifacts.js";
import type { DataQueryInput, SubTaskEnvelope, SubTaskResult } from "../../contracts/types.js";
import type { OrchestratorState } from "../../contracts/schemas.js";
import { log } from "../../lib/log/log.js";
import type { DataQueryResult } from "../../contracts/types.js";
import {
  getBestDataQueryIntent,
  getPlanningTasksByModule,
  getPrimaryPlanningTask,
  isPlanningReady
} from "./intentSelectors.js";

export async function executeDataQueryNode(
  state: OrchestratorState,
  config?: { configurable?: { thread_id?: string } }
): Promise<Partial<OrchestratorState>> {
  const t0 = Date.now();
  const ir = state.intentResult;
  const dq = getBestDataQueryIntent(ir);
  const moduleTasks = getPlanningTasksByModule(ir, "data_query");
  const pt = getPrimaryPlanningTask(ir, "data_query");
  if (
    !ir ||
    !isPlanningReady(ir) ||
    ir.needsClarification ||
    !dq ||
    (dq.missingSlots?.length ?? 0) > 0
  ) {
    log(
      "[Orchestrator]",
      "node execute_data_query 跳过（守卫）",
      `reason=${!ir ? "no_intentResult" : !isPlanningReady(ir) ? "plan_not_ready" : ir.needsClarification ? "needs_clarification" : dq?.missingSlots?.length ? "missing_slots" : "not_data_query"}`,
      t0
    );
    return {};
  }

  log(
    "[Orchestrator]",
    "node execute_data_query 开始",
    `hasSqlQueries=${Boolean(state.input.sqlQueries?.length)} hasSqlQuery=${Boolean(state.input.sqlQuery?.sql?.trim())} domainId=${dq.domainId ?? ""} segmentId=${dq.segmentId ?? ""}`
  );

  const taskId = nanoid();
  const threadId = config?.configurable?.thread_id ?? `thread-${nanoid()}`;

  const envelope: SubTaskEnvelope<DataQueryInput> = {
    taskId,
    threadId,
    agentType: "data_query",
    goal: pt?.goal?.trim() || "执行数据查询并返回统一 DataQueryResult",
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
      if (pt) {
        base.planningTask = {
          taskId: pt.taskId,
          goal: pt.goal,
          systemModuleId: pt.systemModuleId,
          skillSteps: pt.skillSteps?.map((s) => ({
            stepId: s.stepId,
            skillsDomainId: s.skillsDomainId,
            skillsSegmentId: s.skillsSegmentId,
            disclosedSkillIds: s.disclosedSkillIds,
            selectedSkillId: s.selectedSkillId,
            selectedSkillKind: s.selectedSkillKind,
            requiredParams: s.requiredParams,
            providedParams: s.providedParams,
            missingParams: s.missingParams,
            executable: s.executable,
            executionSkillId: s.executionSkillId,
            dbClientKey: s.dbClientKey,
            expectedOutput: s.expectedOutput
          }))
        };
      }
      if (moduleTasks.length > 0) {
        base.planningTasks = moduleTasks.map((t) => ({
          taskId: t.taskId,
          goal: t.goal,
          systemModuleId: t.systemModuleId,
          resolvedSlots: t.resolvedSlots,
          missingSlots: t.missingSlots,
          executable: t.executable,
          skillSteps: t.skillSteps?.map((s) => ({
            stepId: s.stepId,
            skillsDomainId: s.skillsDomainId,
            skillsSegmentId: s.skillsSegmentId,
            disclosedSkillIds: s.disclosedSkillIds,
            selectedSkillId: s.selectedSkillId,
            selectedSkillKind: s.selectedSkillKind,
            requiredParams: s.requiredParams,
            providedParams: s.providedParams,
            missingParams: s.missingParams,
            executable: s.executable,
            executionSkillId: s.executionSkillId,
            dbClientKey: s.dbClientKey,
            expectedOutput: s.expectedOutput
          }))
        }));
      }
      const slots = dq.resolvedSlots;
      const planSlots = pt?.resolvedSlots;
      const mergedSlots = { ...(slots ?? {}), ...(planSlots ?? {}) };
      if (slots && Object.keys(slots).length > 0) {
        base.resolvedSlots = mergedSlots;
      } else if (planSlots && Object.keys(planSlots).length > 0) {
        base.resolvedSlots = planSlots;
      }
      const plannedEntry = pt?.skillSteps?.find((s) => s.selectedSkillId?.trim())?.selectedSkillId;
      if (plannedEntry?.trim()) base.targetIntent = plannedEntry.trim();
      const effectiveDomainId = dq.domainId?.trim() || pt?.systemModuleId?.trim();
      const effectiveSegmentId = dq.segmentId?.trim();
      if (effectiveDomainId) base.domainId = effectiveDomainId;
      if (effectiveSegmentId) {
        base.segmentId = effectiveSegmentId;
        // 兼容旧链路
        base.dataQueryDomain = effectiveSegmentId;
      }
      const plannedSkillId = pt?.skillSteps?.find((s) => s.selectedSkillId?.trim())?.selectedSkillId;
      if (plannedSkillId && !base.targetIntent) {
        base.targetIntent = plannedSkillId;
      }
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
        data: subResult.data as DataQueryResult | undefined,
        artifacts: subResult.artifacts?.map((a) => ({
          id: a.id,
          path: a.path,
          type: a.type
        }))
      }
    }
  };
}
