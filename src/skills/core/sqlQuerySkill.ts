import { tryGetDbClientManager } from "../../config/dbAppContext.js";
import {
  DummyDbClient,
  type DbClient,
  type SqlQueryResult
} from "../../infra/dbClient.js";
import type { SkillContext, SkillDef } from "../types.js";

function resolveDbClient(ctx: SkillContext | undefined): DbClient {
  if (ctx?.dbClient) return ctx.dbClient;
  const key = ctx?.dbClientKey ?? "default";
  const fromManager =
    ctx?.dbClientManager?.tryGet(key) ?? tryGetDbClientManager()?.tryGet(key);
  if (fromManager) return fromManager;
  return new DummyDbClient();
}

export interface SqlSkillInput {
  sql: string;
  params?: unknown[];
  purpose?: string;
}

export async function runSqlQuerySkill(
  input: SqlSkillInput,
  dbClient: DbClient
): Promise<SqlQueryResult> {
  if (input.purpose) {
    console.log("[SqlSkill] purpose:", input.purpose);
  }
  return dbClient.query({ sql: input.sql, params: input.params });
}

/** 供 Registry / 约定式发现注册；`dataQueryGraph` 仍可直接调用 `runSqlQuerySkill` 直至全量接入 Registry */
export const skillDef: SkillDef<SqlSkillInput, SqlQueryResult> = {
  id: "sql-query",
  name: "SQL 查询",
  description: "执行参数化 SQL 查询并返回行集，适用于会员、电商等结构化数据读取。",
  domain: "core",
  capabilities: ["sql", "database"],
  exampleQueries: ["查订单", "查积分", "查最近消费记录"],
  run: async (input, ctx) => {
    return runSqlQuerySkill(input, resolveDbClient(ctx));
  }
};

export default skillDef;
