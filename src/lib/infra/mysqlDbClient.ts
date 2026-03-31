import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import type { DbClient, SqlQueryParams, SqlQueryResult, SqlRow } from "./dbClient.js";

/**
 * MySQL 连接：使用 `mysql2` 连接池。
 * 连接串示例：`mysql://user:password@host:3306/database`
 * SQL 占位符请使用 `?`（与 PostgreSQL 的 `$1` 不同）。
 */
export class MysqlDbClient implements DbClient {
  private readonly pool: Pool;

  constructor(url: string | undefined) {
    const u = url?.trim();
    if (!u) {
      throw new Error("MysqlDbClient: 缺少 url（databases.yaml 中 url 或环境变量）");
    }
    this.pool = mysql.createPool(u);
  }

  async query(input: SqlQueryParams): Promise<SqlQueryResult> {
    const [rows] = await this.pool.execute(input.sql, (input.params ?? []) as never);
    const list = Array.isArray(rows) ? (rows as SqlRow[]) : [];
    return { rows: list, rowCount: list.length };
  }
}
