import oracledb from "oracledb";
import type { Pool } from "oracledb";
import type { DbClient, SqlQueryParams, SqlQueryResult, SqlRow } from "./dbClient.js";

/**
 * 解析 `oracle://user:password@host:port/service`（Easy Connect）。
 * 密码中的特殊字符请在 URL 中做编码（如 `@` → `%40`）。
 */
export function parseOracleJdbcUrl(url: string): {
  user: string;
  password: string;
  connectString: string;
} {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("oracle://")) {
    throw new Error(
      'OracleDbClient: 连接串需为 oracle://user:password@host:port/service 格式，例如 oracle://scott:tiger@localhost:1521/XEPDB1'
    );
  }
  const u = new URL(trimmed);
  const user = decodeURIComponent(u.username || "");
  const password = decodeURIComponent(u.password || "");
  const host = u.hostname;
  const port = u.port || "1521";
  const service = u.pathname.replace(/^\//, "");
  if (!host || !service) {
    throw new Error("OracleDbClient: 无法从 URL 解析 host 或 service 名");
  }
  const connectString = `${host}:${port}/${service}`;
  return { user, password, connectString };
}

/**
 * Oracle 连接：使用 `oracledb` 连接池（Thin 模式无需 Instant Client）。
 * 绑定参数请使用 `:name` 或文档约定的占位符（与 PostgreSQL `$1` 不同）。
 */
export class OracleDbClient implements DbClient {
  private readonly poolPromise: Promise<Pool>;

  constructor(url: string | undefined) {
    const u = url?.trim();
    if (!u) {
      throw new Error("OracleDbClient: 缺少 url（databases.yaml 中 url 或环境变量）");
    }
    const { user, password, connectString } = parseOracleJdbcUrl(u);
    this.poolPromise = oracledb.createPool({
      user,
      password,
      connectString
    });
  }

  async query(input: SqlQueryParams): Promise<SqlQueryResult> {
    const pool = await this.poolPromise;
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute(
        input.sql,
        input.params ?? [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const rows = (result.rows as SqlRow[]) ?? [];
      return { rows, rowCount: rows.length };
    } finally {
      await conn.close();
    }
  }
}
