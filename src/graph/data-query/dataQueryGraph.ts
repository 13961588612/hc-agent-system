import { START, StateGraph } from "@langchain/langgraph";
import { DummyDbClient } from "../../infra/dbClient.js";
import { runSqlQuerySkill } from "../../skills/core/sqlQuerySkill.js";
import type { DataQueryInput, DataQueryResult, QueryDomain } from "../../contracts/types.js";
import { DataQueryState, DataQueryStateSchema } from "../../contracts/schemas.js";
import type { Runnable } from "@langchain/core/runnables";

const builder = new StateGraph(DataQueryStateSchema);

builder.addNode("domain_router", (state: DataQueryState) => {
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
  const db = new DummyDbClient();
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

  const sqlResult = await runSqlQuerySkill({ sql, params }, db);
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
