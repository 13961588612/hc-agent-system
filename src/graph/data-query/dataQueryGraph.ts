import { START, StateGraph } from "@langchain/langgraph";
import { tryGetDbClientManager } from "../../config/dbAppContext.js";
import { DummyDbClient, type DbClient, type SqlQueryResult } from "../../infra/dbClient.js";
import { runSqlQuerySkill } from "../../skills/core/sqlQuerySkill.js";
import type { DataQueryInput, DataQueryResult, QueryDomain } from "../../contracts/types.js";
import { DataQueryState, DataQueryStateSchema } from "../../contracts/schemas.js";
import type { Runnable } from "@langchain/core/runnables";
import { logDebugStep } from "../../infra/debugLog.js";

/** 单任务内 LLM 注入 SQL 条数上限 */
const MAX_SQL_QUERIES = 10;

const MEMBER_DB_KEY = "member";

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
  const mgr = tryGetDbClientManager();
  const primary = mgr?.tryGet(key);
  if (primary) return primary;
  const fallback = mgr?.tryGet("default");
  if (fallback) return fallback;
  return new DummyDbClient();
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
  try {
    return await runSqlQuerySkill({ sql, params, purpose }, db);
  } catch (err) {
    if (dbKey !== MEMBER_DB_KEY) throw err;
    const fb = tryGetDbClientManager()?.tryGet("default");
    if (!fb || fb === db) throw err;
    console.warn(
      `[DataQuery] 数据源 "${dbKey}" 执行失败，回退 default：`,
      err instanceof Error ? err.message : err
    );
    return runSqlQuerySkill({ sql, params, purpose }, fb);
  }
}

const builder = new StateGraph(DataQueryStateSchema);

builder.addNode("domain_router", (state: DataQueryState) => {
  logDebugStep(
    "[DataQuery]",
    "node domain_router",
    `sqlQueries=${state.input.sqlQueries?.length ?? 0} hasSqlQuery=${Boolean(state.input.sqlQuery?.sql?.trim())} structured=${Boolean(state.input.dataQueryDomain && state.input.targetIntent?.trim())}`
  );
  if (state.input.sqlQueries?.length) {
    return {
      ...state,
      queryDomain: "member" as QueryDomain,
      queryIntent: "llm_sql_batch"
    };
  }

  if (state.input.sqlQuery?.sql?.trim()) {
    return {
      ...state,
      queryDomain: "member" as QueryDomain,
      queryIntent: "llm_sql"
    };
  }

  /** 第二期：意图节点下发的域 + 目标意图，优先于关键词猜意图 */
  if (state.input.dataQueryDomain && state.input.targetIntent?.trim()) {
    return {
      ...state,
      queryDomain: state.input.dataQueryDomain,
      queryIntent: state.input.targetIntent.trim()
    };
  }

  const text = state.input.userInput;
  let queryDomain: QueryDomain = "other";
  let queryIntent = "unknown";

  if (text.includes("会员") || text.includes("积分") || text.includes("等级")) {
    queryDomain = "member";
    queryIntent = "member_points_recent";
  } else if (text.includes("订单") || text.includes("物流") || text.includes("快递")) {
    queryDomain = "ecommerce";
    queryIntent = "ecom_orders_recent";
  }

  return { ...state, queryDomain, queryIntent };
});

builder.addNode("execute_query", async (state: DataQueryState) => {
  logDebugStep(
    "[DataQuery]",
    "node execute_query 开始",
    `queryDomain=${state.queryDomain ?? ""} queryIntent=${state.queryIntent ?? ""}`
  );
  const demoDb = resolveDbClientByKey("default");

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
        logDebugStep(
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
        logDebugStep(
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
          domain: "member",
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
        domain: "member",
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
      logDebugStep("[DataQuery]", "单条 LLM SQL 执行完成", `label=${label}`, tSql);
      const result: DataQueryResult = {
        domain: "member",
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
          domain: "member",
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

  if (state.queryDomain === "member" && state.queryIntent === "member_points_recent") {
    sql =
      "SELECT change, reason, created_at FROM member_points WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5";
    params = [effectiveDemoUserId(state.input)];
  } else if (state.queryDomain === "ecommerce" && state.queryIntent === "ecom_orders_recent") {
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
  const sqlResult = await runSqlQuerySkill({ sql, params }, demoDb);
  logDebugStep(
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
builder.addEdge("domain_router" as any, "execute_query" as any);

const dataQueryApp = builder.compile() as unknown as Runnable<
  { input: DataQueryInput },
  { result: DataQueryResult }
>;

export async function runDataQueryGraph(input: DataQueryInput): Promise<DataQueryResult> {
  const t0 = Date.now();
  logDebugStep(
    "[DataQuery]",
    "子图 dataQueryApp.invoke 开始",
    `userInputLen=${input.userInput.length} sqlQueries=${input.sqlQueries?.length ?? 0} hasSqlQuery=${Boolean(input.sqlQuery?.sql?.trim())} targetIntent=${input.targetIntent ?? ""} dataQueryDomain=${input.dataQueryDomain ?? ""} resolvedSlotKeys=${input.resolvedSlots ? Object.keys(input.resolvedSlots).join(",") : ""}`
  );
  const result = await dataQueryApp.invoke({ input });
  logDebugStep("[DataQuery]", "子图 dataQueryApp.invoke 结束", undefined, t0);
  return result.result ?? {
    domain: "other",
    intent: "unknown",
    dataType: "table",
    meta: {},
    rows: []
  };
}
