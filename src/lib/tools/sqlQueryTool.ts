import { SqlQueryResult } from "../infra/dbClient.js";
import { runSqlQuerySkill, SqlSkillInput, SqlSkillInputSchema } from "../skills/core/sqlQuerySkill.js";

export const sqlQueryTool = {
  name: "sql_query",
  description: "执行 SQL 查询（支持 params、purpose、dbClientKey）",
  schema: SqlSkillInputSchema
};

export async function runSqlQueryTool(sqlQueryInput: SqlSkillInput): Promise<string> {
  const result: SqlQueryResult = await runSqlQuerySkill(sqlQueryInput);
  return JSON.stringify(result, null, 2);
}
