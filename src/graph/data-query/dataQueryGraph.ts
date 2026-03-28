import { START, StateGraph } from "@langchain/langgraph";
import { tryGetDbClientManager } from "../../config/dbAppContext.js";
import { DummyDbClient, type DbClient, type SqlQueryResult } from "../../infra/dbClient.js";
import { runSqlQuerySkill } from "../../skills/core/sqlQuerySkill.js";
import type { DataQueryInput, DataQueryResult, QueryDomain } from "../../contracts/types.js";
import { DataQueryState, DataQueryStateSchema } from "../../contracts/schemas.js";
import type { Runnable } from "@langchain/core/runnables";

/** 单任务内 LLM 注入 SQL 条数上限 */
const MAX_SQL_QUERIES = 10;

const MEMBER_DB_KEY = "member";

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
      try {
        const sqlResult = await runSqlQuerySkillWithOptionalFallback(
          sql,
          params,
          purpose,
          dbKey,
          db
        );
        tables.push({
          name: label,
          meta: { dbClientKey: dbKey },
          rows: sqlResult.rows
        });
        steps.push({ kind: "sql" as const, id: label, sql, params });
      } catch (e) {
        stepErrors[label] = e instanceof Error ? e.message : String(e);
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
      const sqlResult = await runSqlQuerySkillWithOptionalFallback(
        sql,
        params,
        purpose,
        dbKey,
        db
      );
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
    params = [state.input.userId ?? "demo-user"];
  } else if (state.queryDomain === "ecommerce" && state.queryIntent === "ecom_orders_recent") {
    sql =
      "SELECT order_id, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5";
    params = [state.input.userId ?? "demo-user"];
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

  const sqlResult = await runSqlQuerySkill({ sql, params }, demoDb);
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
  const result = await dataQueryApp.invoke({ input });
  return result.result ?? {
    domain: "other",
    intent: "unknown",
    dataType: "table",
    meta: {},
    rows: []
  };
}
