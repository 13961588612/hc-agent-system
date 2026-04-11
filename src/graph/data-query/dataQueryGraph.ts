import { START, StateGraph } from "@langchain/langgraph";
import { dbClientManager } from "../../lib/infra/dbClientManager.js";
import { DummyDbClient, type DbClient, type SqlQueryResult } from "../../lib/infra/dbClient.js";
import { runSqlQueryTool } from "../../lib/tools/sqlQueryTool.js";
import { runInvokeSkillTool } from "../../lib/tools/skillsTools.js";
import type { SqlSkillInput } from "../../lib/skills/core/sqlQuerySkill.js";
import type { DataQueryInput, DataQueryResult, QueryDomain } from "../../contracts/types.js";
import { DataQueryState, DataQueryStateSchema } from "../../contracts/schemas.js";
import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../../model/index.js";
import { log } from "../../lib/log/log.js";
import { getSystemConfigSync, listQuerySegmentIds } from "../../config/systemConfig.js";

/** 单任务内 LLM 注入 SQL 条数上限 */
const MAX_SQL_QUERIES = 10;

const MEMBER_DB_KEY = "member";

/** LLM 注入 SQL 等无结构化域时的默认 `queryDomain`（取当前配置下首个问数 segment id） */
function defaultQueryDomainTag(): QueryDomain {
  const ids = listQuerySegmentIds(getSystemConfigSync());
  return ids[0] ?? "other";
}

/** 关键词猜意图失败时的默认域：优先 `other`，否则首个 segment */
function fallbackQueryDomainFromConfig(): QueryDomain {
  const ids = listQuerySegmentIds(getSystemConfigSync());
  if (ids.includes("other")) return "other";
  return ids[0] ?? "other";
}

/**
 * 演示 SQL 用户参数：优先 `resolvedSlots.user_id` / `userId` / `phone`，否则 `input.userId`。
 */
function effectiveDemoUserId(input: DataQueryInput): string {
  const s = input.resolvedSlots;
  const fromSlot =
    (s && typeof s["user_id"] === "string" && s["user_id"].trim()) ||
    (s && typeof s["userId"] === "string" && s["userId"].trim()) ||
    (s && typeof s["phone"] === "string" && s["phone"].trim());
  if (fromSlot) return fromSlot;
  return input.userId?.trim() || "demo-user";
}

/**
 * 按连接键解析客户端；若无则回退 `default`，再回退 Dummy。
 */
function resolveDbClientByKey(key: string): DbClient {
  const primary = dbClientManager?.tryGet(key);
  if (primary) return primary;
  const fallback = dbClientManager?.tryGet("default");
  if (fallback) return fallback;
  return new DummyDbClient();
}

function normalizeSqlPlaceholdersByDbKey(sql: string, dbKey?: string): string {
  const key = (dbKey ?? "").trim().toLowerCase();
  // 当前 member 库走 Oracle，Oracle 绑定占位符需 :1/:name，兼容 LLM 常产出的 $1/$2
  if (key === MEMBER_DB_KEY || key === "oracle") {
    let out = sql.replace(/\$(\d+)/g, ":$1");
    // 兼容 `?` 占位符（JDBC/MySQL 风格）-> Oracle 序号绑定 :1/:2/...
    if (out.includes("?")) {
      let idx = 0;
      out = out.replace(/\?/g, () => {
        idx += 1;
        return `:${idx}`;
      });
    }
    return out;
  }
  return sql;
}

/**
 * `member` 数据源执行失败时回退 `default`（如本地 Oracle Thin/版本问题），便于联调。
 */
async function runSqlQuerySkillWithOptionalFallback(
  sql: string,
  params: unknown[],
  purpose: string,
  dbKey: string,
  db: DbClient
): Promise<SqlQueryResult> {
  if (purpose) {
    console.log("[SqlSkill] purpose:", purpose);
  }
  try {
    return await db.query({ sql, params });
  } catch (err) {
    if (dbKey !== MEMBER_DB_KEY) throw err;
    const fb = dbClientManager?.tryGet("default");
    if (!fb || fb === db) throw err;
    console.warn(
      `[DataQuery] 数据源 "${dbKey}" 执行失败，回退 default：`,
      err instanceof Error ? err.message : err
    );
    return fb.query({ sql, params });
  }
}

type PlannedStep = {
  stepId?: string;
  skillEntryId: string;
  skillId: string;
  executionSkillId?: string;
  dbClientKey?: string;
  missingParams?: string[];
  executable?: boolean;
};

function pickSelectedSkillPlansFromTask(
  task: DataQueryInput["planningTask"]
): PlannedStep[] {
  const steps = task?.skillSteps ?? [];
  const plans: PlannedStep[] = [];
  for (const s of steps) {
    const id = s.selectedSkillId?.trim();
    if (!id) continue;
    plans.push({
      stepId: s.stepId,
      skillEntryId: id,
      skillId: id,
      executionSkillId: s.executionSkillId?.trim() || undefined,
      dbClientKey: s.dbClientKey?.trim() || undefined,
      missingParams: s.missingParams,
      executable: s.executable
    });
  }
  return plans;
}

function pickSelectedSkillPlans(
  input: DataQueryInput
): PlannedStep[] {
  const plans = pickSelectedSkillPlansFromTask(input.planningTask);
  if (plans.length > 0) return plans;
  const fallback = input.targetIntent?.trim();
  return fallback ? [{ skillEntryId: fallback, skillId: fallback }] : [];
}

function pickPlanningTaskQueue(
  input: DataQueryInput
): Array<NonNullable<DataQueryInput["planningTask"]>> {
  if (input.planningTasks?.length) {
    return input.planningTasks.filter(
      (t): t is NonNullable<DataQueryInput["planningTask"]> => !!t
    );
  }
  return input.planningTask ? [input.planningTask] : [];
}

function extractJsonObject(text: string): string {
  const s = text.trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) {
    throw new Error("LLM 未返回 JSON 对象");
  }
  return s.slice(first, last + 1);
}

async function buildSqlBySkillWithLlm(input: {
  userInput: string;
  resolvedSlots?: Record<string, unknown>;
  skillId: string;
  skillDetailJson: string;
  preferredDbClientKey?: string;
  priorTables?: Array<{ name?: string; meta?: Record<string, unknown>; rows: Array<Record<string, unknown>> }>;
  priorRows?: Array<Record<string, unknown>>;
  taskGoal?: string;
  stepId?: string;
}): Promise<SqlSkillInput> {
  const llm = getModel();
  const promptBase = [
    "你是数据查询 SQL 生成器。",
    "任务：根据用户问题、槽位、skill 详情，输出可执行的参数化 SQL 输入。",
    "必须仅输出 JSON 对象，不要 markdown，不要解释。",
    "JSON schema:",
    '{ "sql": "string", "params": ["any"], "dbClientKey": "string", "purpose": "string" }',
    "- 必须使用参数化 SQL，禁止拼接用户输入到 SQL 文本。",
    "- dbClientKey 不能为空。",
    `- 若已给定 preferredDbClientKey，请优先使用：${input.preferredDbClientKey ?? "（未指定）"}`,
    "- 可使用 priorRows/priorTables 中的上游结果作为本步过滤条件或关联条件。",
    "- 【硬约束1】SQL 只能引用 skill详情中明确出现的表/视图/字段；禁止编造对象名（例如 members 这类未在 skill详情出现的表名）。",
    "- 【硬约束2】若 skill详情或库规范要求 schema 前缀，必须使用完整对象名（如 SCHEMA.TABLE）；不得省略前缀。",
    "- 【硬约束3】SELECT 字段清单与字段别名必须与 skill详情保持一致；禁止新增字段、改名别名或调整含义。",
    "- label 与 purpose 默认使用 skillId。",
    "",
    `taskGoal: ${input.taskGoal ?? ""}`,
    `stepId: ${input.stepId ?? ""}`,
    `skillId: ${input.skillId}`,
    `用户输入: ${input.userInput}`,
    `槽位: ${JSON.stringify(input.resolvedSlots ?? {}, null, 2)}`,
    `上游 rows: ${JSON.stringify(input.priorRows ?? [], null, 2)}`,
    `上游 tables: ${JSON.stringify(input.priorTables ?? [], null, 2)}`,
    `skill详情: ${input.skillDetailJson}`
  ].join("\n");

  const invokeAndParse = async (prompt: string): Promise<{ parsed: Record<string, unknown>; content: string }> => {
    const raw = await llm.invoke([new SystemMessage("你只返回 JSON。"), new HumanMessage(prompt)]);
    const content =
      typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content);
    const jsonText = extractJsonObject(content);
    return { parsed: JSON.parse(jsonText) as Record<string, unknown>, content };
  };

  let first: { parsed: Record<string, unknown>; content: string };
  try {
    first = await invokeAndParse(promptBase);
  } catch (e) {
    throw new Error(
      `LLM 生成 SQL 失败（首轮解析失败）：${e instanceof Error ? e.message : String(e)}`
    );
  }
  let sql = String(first.parsed.sql ?? "").trim();
  if (!sql) {
    const retryPrompt = [
      promptBase,
      "",
      "上轮返回未给出有效 sql。",
      "重试要求（必须遵守）：",
      "- 必须返回非空 `sql` 字段；",
      "- 若不确定，优先复用 skill详情中的原始 SQL 模板并仅做参数化绑定；",
      "- 仍只返回 JSON 对象。"
    ].join("\n");
    const second = await invokeAndParse(retryPrompt);
    sql = String(second.parsed.sql ?? "").trim();
    if (!sql) {
      throw new Error(
        `LLM 生成 SQL 为空（重试后仍为空），modelContent=${second.content.slice(0, 400)}`
      );
    }
    const normalizedRetry = {
      sql,
      params: Array.isArray(second.parsed.params) ? second.parsed.params : [],
      dbClientKey:
        String(second.parsed.dbClientKey ?? "").trim() ||
        input.preferredDbClientKey?.trim() ||
        "member",
      purpose: String(second.parsed.purpose ?? "").trim() || input.skillId
    };
    return normalizedRetry;
  }
  return {
    sql,
    params: Array.isArray(first.parsed.params) ? first.parsed.params : [],
    dbClientKey:
      String(first.parsed.dbClientKey ?? "").trim() ||
      input.preferredDbClientKey?.trim() ||
      "member",
    purpose: String(first.parsed.purpose ?? "").trim() || input.skillId
  };
}

const builder = new StateGraph(DataQueryStateSchema);

builder.addNode("domain_router", (state: DataQueryState) => {
  log(
    "[DataQuery]",
    "node domain_router",
    `sqlQueries=${state.input.sqlQueries?.length ?? 0} hasSqlQuery=${Boolean(state.input.sqlQuery?.sql?.trim())} structured=${Boolean((state.input.segmentId || state.input.dataQueryDomain) && state.input.targetIntent?.trim())}`
  );
  if (state.input.sqlQueries?.length) {
    return {
      ...state,
      queryDomain: defaultQueryDomainTag(),
      queryIntent: "llm_sql_batch"
    };
  }

  if (state.input.sqlQuery?.sql?.trim()) {
    return {
      ...state,
      queryDomain: defaultQueryDomainTag(),
      queryIntent: "llm_sql"
    };
  }

  /** 第二期：意图节点下发的域 + 目标意图，优先于关键词猜意图 */
  const segment = state.input.segmentId ?? state.input.dataQueryDomain;
  if (segment && state.input.targetIntent?.trim()) {
    return {
      ...state,
      queryDomain: segment,
      queryIntent: state.input.targetIntent.trim()
    };
  }

  const text = state.input.userInput;
  const segments = listQuerySegmentIds(getSystemConfigSync());
  let queryDomain: QueryDomain = fallbackQueryDomainFromConfig();
  let queryIntent = "unknown";

  if (text.includes("会员") || text.includes("积分") || text.includes("等级")) {
    queryDomain = segments.includes("member") ? "member" : queryDomain;
    queryIntent = "member_points_recent";
  } else if (text.includes("订单") || text.includes("物流") || text.includes("快递")) {
    queryDomain = segments.includes("ecommerce") ? "ecommerce" : queryDomain;
    queryIntent = "ecom_orders_recent";
  }

  return { ...state, queryDomain, queryIntent };
});

builder.addNode("generate_sql", async (state: DataQueryState) => {
  log(
    "[DataQuery]",
    "node generate_sql 开始",
    `queryDomain=${state.queryDomain ?? ""} queryIntent=${state.queryIntent ?? ""}`
  );
  const demoDb = resolveDbClientByKey("default");
  const taskQueue = pickPlanningTaskQueue(state.input);

  if (
    !state.input.sqlQueries?.length &&
    !state.input.sqlQuery?.sql?.trim() &&
    taskQueue.length > 0
  ) {
    const tPlan = Date.now();
    const tables: Array<{
      name?: string;
      meta?: Record<string, unknown>;
      rows: Array<Record<string, unknown>>;
    }> = [];
    const steps: Array<{ kind: "sql"; id?: string; sql: string; params?: unknown[] }> = [];
    const stepErrors: Record<string, string> = {};
    let priorTables = state.input.sharedContext?.priorTables ?? [];
    let priorRows = state.input.sharedContext?.priorRows ?? [];

    for (let ti = 0; ti < taskQueue.length; ti++) {
      const task = taskQueue[ti]!;
      const taskId = task.taskId?.trim() || `task_${ti + 1}`;
      const taskPlans = pickSelectedSkillPlansFromTask(task);

      if (task.executable === false) {
        stepErrors[`${taskId}:task_guard`] = "task.executable=false（跳过该任务）";
        continue;
      }
      if (taskPlans.length === 0) {
        stepErrors[`${taskId}:task_guard`] = "该任务未选出可执行 skill";
        continue;
      }

      let taskFailed = false;
      for (let si = 0; si < taskPlans.length; si++) {
        const plan = taskPlans[si]!;
        const stepKey = `${taskId}:${plan.stepId || plan.skillId || `step_${si + 1}`}`;
        let lastSqlPreview = "";
        let lastParamsCount = 0;
        if (plan.executable === false || (plan.missingParams?.length ?? 0) > 0) {
          stepErrors[stepKey] = `步骤不可执行，缺参: ${(plan.missingParams ?? []).join(",")}`;
          taskFailed = true;
          break;
        }
        if (
          plan.executionSkillId &&
          plan.executionSkillId !== "sql_query" &&
          plan.executionSkillId !== "sql-query"
        ) {
          stepErrors[stepKey] = `executionSkillId=${plan.executionSkillId}，当前仅支持 sql_query`;
          taskFailed = true;
          break;
        }
        try {
          const skillDetailJson = await runInvokeSkillTool(plan.skillId);
          const sqlQueryInput = await buildSqlBySkillWithLlm({
            userInput: state.input.userInput,
            resolvedSlots: {
              ...(state.input.resolvedSlots ?? {}),
              ...(task.resolvedSlots ?? {})
            },
            skillId: plan.skillId,
            skillDetailJson,
            preferredDbClientKey: plan.dbClientKey,
            priorRows,
            priorTables,
            taskGoal: task.goal,
            stepId: plan.stepId
          });
          sqlQueryInput.sql = normalizeSqlPlaceholdersByDbKey(
            sqlQueryInput.sql,
            sqlQueryInput.dbClientKey
          );
          lastSqlPreview = sqlQueryInput.sql;
          lastParamsCount = sqlQueryInput.params?.length ?? 0;
          const sqlResultText = await runSqlQueryTool(sqlQueryInput);
          const sqlResult = JSON.parse(sqlResultText) as SqlQueryResult;

          steps.push({
            kind: "sql" as const,
            id: stepKey,
            sql: sqlQueryInput.sql,
            params: sqlQueryInput.params
          });
          const table = {
            name: stepKey,
            meta: {
              dbClientKey: sqlQueryInput.dbClientKey ?? "member",
              taskId,
              stepId: plan.stepId,
              skillId: plan.skillId
            },
            rows: sqlResult.rows
          };
          tables.push(table);
          priorTables = [...priorTables, table].slice(-12);
          priorRows = [...priorRows, ...sqlResult.rows].slice(-300);
          log(
            "[DataQuery]",
            "串行子任务单步完成",
            `task=${ti + 1}/${taskQueue.length} step=${si + 1}/${taskPlans.length} stepKey=${stepKey} rowCount=${sqlResult.rowCount}`
          );
        } catch (e) {
          stepErrors[stepKey] = e instanceof Error ? e.message : String(e);
          log(
            "[DataQuery]",
            "串行子任务单步失败",
            `stepKey=${stepKey} err=${stepErrors[stepKey]?.slice(0, 200)}`
          );
          if (lastSqlPreview) {
            log(
              "[DataQuery]",
              "失败 SQL 预览",
              `stepKey=${stepKey} paramsCount=${lastParamsCount} sql=${lastSqlPreview.slice(0, 600)}`
            );
          }
          taskFailed = true;
          break; // 子任务内 fail-fast
        }
      }
      if (taskFailed) {
        log("[DataQuery]", "子任务失败，继续下一任务", `taskId=${taskId}`);
      }
    }

    const hasTables = tables.length > 0;
    const hasErr = Object.keys(stepErrors).length > 0;
    log(
      "[DataQuery]",
      "planningTasks 串行链路完成",
      `tasks=${taskQueue.length} successTables=${tables.length} failedSteps=${Object.keys(stepErrors).length}`,
      tPlan
    );
    if (!hasTables && hasErr) {
      return {
        ...state,
        executionPlan: { steps },
        result: {
          domain: state.queryDomain ?? defaultQueryDomainTag(),
          intent: taskQueue[0]?.taskId ?? "unknown",
          dataType: "table" as const,
          meta: {
            source: "planning_tasks_serial",
            error: "串行任务全部失败",
            stepErrors
          },
          rows: []
        }
      };
    }
    return {
      ...state,
      executionPlan: { steps },
      result: {
        domain: state.queryDomain ?? defaultQueryDomainTag(),
        intent: taskQueue[0]?.taskId ?? "unknown",
        dataType: tables.length > 1 ? ("tables" as const) : ("table" as const),
        meta: {
          source: "planning_tasks_serial",
          ...(hasErr ? { stepErrors } : {}),
          taskCount: taskQueue.length
        },
        rows: tables.length === 1 ? tables[0]!.rows : [],
        ...(tables.length > 1 ? { tables } : {})
      }
    };
  }

  const selectedSkillPlans = pickSelectedSkillPlans(state.input).slice(0, MAX_SQL_QUERIES);

  if (
    !state.input.sqlQueries?.length &&
    !state.input.sqlQuery?.sql?.trim() &&
    selectedSkillPlans.length > 0
  ) {
    try {
      const tPlan = Date.now();
      const tables: Array<{
        name?: string;
        meta?: Record<string, unknown>;
        rows: Array<Record<string, unknown>>;
      }> = [];
      const steps: Array<{ kind: "sql"; id?: string; sql: string; params?: unknown[] }> = [];
      const stepErrors: Record<string, string> = {};

      for (let i = 0; i < selectedSkillPlans.length; i++) {
        const plan = selectedSkillPlans[i]!;
        const skillId = plan.skillId;
        try {
          const skillDetailJson = await runInvokeSkillTool(skillId);
          const sqlQueryInput = await buildSqlBySkillWithLlm({
            userInput: state.input.userInput,
            resolvedSlots: state.input.resolvedSlots,
            skillId,
            skillDetailJson,
            preferredDbClientKey: plan.dbClientKey
          });
          sqlQueryInput.sql = normalizeSqlPlaceholdersByDbKey(
            sqlQueryInput.sql,
            sqlQueryInput.dbClientKey
          );
          const sqlResultText = await runSqlQueryTool(sqlQueryInput);
          const sqlResult = JSON.parse(sqlResultText) as SqlQueryResult;
          steps.push({
            kind: "sql" as const,
            id: skillId,
            sql: sqlQueryInput.sql,
            params: sqlQueryInput.params
          });
          tables.push({
            name: skillId,
            meta: { dbClientKey: sqlQueryInput.dbClientKey ?? "member" },
            rows: sqlResult.rows
          });
          log(
            "[DataQuery]",
            "按 planningTask/skillId 执行单步完成",
            `step=${i + 1}/${selectedSkillPlans.length} skillId=${skillId} rowCount=${sqlResult.rowCount}`
          );
        } catch (e) {
          stepErrors[skillId] = e instanceof Error ? e.message : String(e);
          log(
            "[DataQuery]",
            "按 planningTask/skillId 执行单步失败",
            `skillId=${skillId} err=${stepErrors[skillId]?.slice(0, 200)}`
          );
        }
      }

      const hasTables = tables.length > 0;
      const hasErr = Object.keys(stepErrors).length > 0;
      log(
        "[DataQuery]",
        "planningTask skill 链路完成",
        `steps=${selectedSkillPlans.length} success=${tables.length} failed=${Object.keys(stepErrors).length}`,
        tPlan
      );
      if (!hasTables && hasErr) {
        return {
          ...state,
          executionPlan: { steps },
          result: {
            domain: state.queryDomain ?? defaultQueryDomainTag(),
            intent: selectedSkillPlans[0]?.skillId ?? "unknown",
            dataType: "table" as const,
            meta: {
              source: "planning_task_skill_chain",
              error: "skill 链路全部执行失败",
              stepErrors
            },
            rows: []
          }
        };
      }
      return {
        ...state,
        executionPlan: { steps },
        result: {
          domain: state.queryDomain ?? defaultQueryDomainTag(),
          intent: selectedSkillPlans[0]?.skillId ?? "unknown",
          dataType: tables.length > 1 ? ("tables" as const) : ("table" as const),
          meta: {
            source: "planning_task_skill_chain",
            ...(hasErr ? { stepErrors } : {})
          },
          rows: tables.length === 1 ? tables[0]!.rows : [],
          ...(tables.length > 1 ? { tables } : {})
        }
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("[DataQuery]", "planningTask skill 链路失败，回退旧逻辑", msg.slice(0, 160));
    }
  }

  if (state.input.sqlQueries?.length) {
    const list = state.input.sqlQueries.slice(0, MAX_SQL_QUERIES);
    const truncated =
      state.input.sqlQueries.length > MAX_SQL_QUERIES
        ? state.input.sqlQueries.length - MAX_SQL_QUERIES
        : 0;

    const steps: Array<{ kind: "sql"; id?: string; sql: string; params?: unknown[] }> = [];
    const tables: Array<{
      name?: string;
      meta?: Record<string, unknown>;
      rows: Array<Record<string, unknown>>;
    }> = [];
    const stepErrors: Record<string, string> = {};

    for (let i = 0; i < list.length; i++) {
      const item = list[i]!;
      const sql = item.sql?.trim() ?? "";
      const label = item.label?.trim() || `sql_${i}`;
      const purpose = item.purpose?.trim() || label;
      if (!sql) {
        stepErrors[label] = "sql 为空";
        continue;
      }
      const dbKey = item.dbClientKey?.trim() || "default";
      const db = resolveDbClientByKey(dbKey);
      const params = item.params ?? [];
      const tSql = Date.now();
      try {
        const sqlResult = await runSqlQuerySkillWithOptionalFallback(
          sql,
          params,
          purpose,
          dbKey,
          db
        );
        log(
          "[DataQuery]",
          `SQL 批量第 ${i + 1}/${list.length} 条成功`,
          `label=${label}`,
          tSql
        );
        tables.push({
          name: label,
          meta: { dbClientKey: dbKey },
          rows: sqlResult.rows
        });
        steps.push({ kind: "sql" as const, id: label, sql, params });
      } catch (e) {
        stepErrors[label] = e instanceof Error ? e.message : String(e);
        log(
          "[DataQuery]",
          `SQL 批量第 ${i + 1}/${list.length} 条失败`,
          `label=${label} err=${stepErrors[label]?.slice(0, 120)}`,
          tSql
        );
      }
    }

    const hasTables = tables.length > 0;
    const hasErr = Object.keys(stepErrors).length > 0;

    if (!hasTables && hasErr) {
      return {
        ...state,
        executionPlan: { steps },
        result: {
          domain: state.queryDomain ?? defaultQueryDomainTag(),
          intent: "llm_sql_batch",
          dataType: "table" as const,
          meta: {
            error: "SQL 批量执行全部失败",
            stepErrors,
            ...(truncated > 0 ? { truncatedQueries: truncated } : {})
          },
          rows: []
        }
      };
    }

    return {
      ...state,
      executionPlan: { steps },
      result: {
        domain: state.queryDomain ?? defaultQueryDomainTag(),
        intent: "llm_sql_batch",
        dataType: "tables" as const,
        meta: {
          ...(hasErr ? { stepErrors } : {}),
          ...(truncated > 0 ? { truncatedQueries: truncated } : {})
        },
        rows: [],
        tables
      }
    };
  }

  if (state.input.sqlQuery?.sql?.trim()) {
    const item = state.input.sqlQuery;
    const sql = item.sql.trim();
    const label = item.label?.trim() || "llm_sql";
    const purpose = item.purpose?.trim() || label;
    const dbKey = item.dbClientKey?.trim() || "default";
    const db = resolveDbClientByKey(dbKey);
    const params = item.params ?? [];

    try {
      const tSql = Date.now();
      const sqlResult = await runSqlQuerySkillWithOptionalFallback(
        sql,
        params,
        purpose,
        dbKey,
        db
      );
      log("[DataQuery]", "单条 LLM SQL 执行完成", `label=${label}`, tSql);
      const result: DataQueryResult = {
        domain: state.queryDomain ?? defaultQueryDomainTag(),
        intent: label,
        dataType: "table",
        meta: { dbClientKey: dbKey, label },
        rows: sqlResult.rows
      };
      return {
        ...state,
        executionPlan: {
          steps: [{ kind: "sql" as const, id: label, sql, params }]
        },
        result
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ...state,
        result: {
          domain: state.queryDomain ?? defaultQueryDomainTag(),
          intent: label,
          dataType: "table",
          meta: { error: msg, label, dbClientKey: dbKey },
          rows: []
        }
      };
    }
  }

  let sql = "";
  let params: unknown[] = [];

  if (state.queryIntent === "member_points_recent") {
    sql =
      "SELECT change, reason, created_at FROM member_points WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5";
    params = [effectiveDemoUserId(state.input)];
  } else if (state.queryIntent === "ecom_orders_recent") {
    sql =
      "SELECT order_id, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5";
    params = [effectiveDemoUserId(state.input)];
  } else {
    return {
      ...state,
      result: {
        domain: state.queryDomain ?? "other",
        intent: state.queryIntent ?? "unknown",
        dataType: "table",
        meta: { note: "no matching demo query" },
        rows: []
      }
    };
  }

  const tDemo = Date.now();
  const sqlResult = await demoDb.query({ sql, params });
  log(
    "[DataQuery]",
    "演示 SQL 执行完成",
    `intent=${state.queryIntent ?? ""} userParamLen=${effectiveDemoUserId(state.input).length}`,
    tDemo
  );
  const result: DataQueryResult = {
    domain: state.queryDomain ?? "other",
    intent: state.queryIntent ?? "unknown",
    dataType: "table",
    meta: {},
    rows: sqlResult.rows
  };

  return {
    ...state,
    executionPlan: {
      steps: [{ kind: "sql" as const, sql, params }]
    },
    result
  };
});

builder.addEdge(START, "domain_router" as any);
builder.addEdge("domain_router" as any, "generate_sql" as any);

const dataQueryApp = builder.compile() as unknown as Runnable<
  { input: DataQueryInput },
  { result: DataQueryResult }
>;

export async function runDataQueryGraph(input: DataQueryInput): Promise<DataQueryResult> {
  const t0 = Date.now();
  log(
    "[DataQuery]",
    "子图 dataQueryApp.invoke 开始",
    `userInputLen=${input.userInput.length} sqlQueries=${input.sqlQueries?.length ?? 0} hasSqlQuery=${Boolean(input.sqlQuery?.sql?.trim())} targetIntent=${input.targetIntent ?? ""} domainId=${input.domainId ?? ""} segmentId=${input.segmentId ?? input.dataQueryDomain ?? ""} resolvedSlotKeys=${input.resolvedSlots ? Object.keys(input.resolvedSlots).join(",") : ""}`
  );
  const result = await dataQueryApp.invoke({ input });
  log("[DataQuery]", "子图 dataQueryApp.invoke 结束", undefined, t0);
  return result.result ?? {
    domain: "other",
    intent: "unknown",
    dataType: "table",
    meta: {},
    rows: []
  };
}
