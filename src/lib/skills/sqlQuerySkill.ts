import {
  DummyDbClient,
  type DbClient,
  type SqlQueryResult
} from "../infra/dbClient.js";
import { dbClientManager } from "../infra/dbClientManager.js";
import { z } from "zod";

function resolveDbClient(dbClientKey: string): DbClient {
  const fromManager = dbClientManager.tryGet(dbClientKey);
  if (fromManager) return fromManager;
  return new DummyDbClient();
}

export const SqlSkillInputSchema= z.object({
  /** 要执行的参数化 SQL 语句（建议使用占位符，避免字符串拼接） */
  sql: z.string(),
  /** SQL 占位符对应的参数数组，按顺序绑定 */
  params: z.array(z.unknown()).optional(),
  /** 本次查询的业务目的说明，用于日志与审计追踪 */
  purpose: z.string().optional(),
  /** 要使用的数据库客户端名称，缺省为 `default` */
  dbClientKey: z.string().optional()
});

export type SqlSkillInput = z.infer<typeof SqlSkillInputSchema>;

export async function runSqlQuerySkill(
  input: SqlSkillInput
): Promise<SqlQueryResult> {
  const dbClient = resolveDbClient(input.dbClientKey ?? "default");
  if (input.purpose) {
    console.log("[SqlSkill] purpose:", input.purpose);
  }
  return dbClient.query({ sql: input.sql, params: input.params });
}

