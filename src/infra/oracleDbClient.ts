import oracledb from "oracledb";
import type { Pool } from "oracledb";
import type { DbClient, SqlQueryParams, SqlQueryResult, SqlRow } from "./dbClient.js";

/** Thick 模式仅可初始化一次 */
let oracleThickModeInitialized = false;

/**
 * Oracle 11g 等旧版本库不支持 node-oracledb **Thin** 模式（会报 NJS-138），需启用 **Thick** 并安装 Instant Client。
 * - 设置 `ORACLE_CLIENT_LIB_DIR` 为 Instant Client 解压目录（Windows 常用），在首次建池前调用 `initOracleClient`。
 * - 或设置 `ORACLE_USE_THICK=1` 且已配置好系统库路径（如 Linux `LD_LIBRARY_PATH`），将调用无参 `initOracleClient()`。
 */
export function ensureOracleThickModeFromEnv(): void {
  if (oracleThickModeInitialized) return;

  const libDir = process.env.ORACLE_CLIENT_LIB_DIR?.trim();
  const useThickFlag = process.env.ORACLE_USE_THICK?.trim();
  const useThick =
    Boolean(libDir) ||
    useThickFlag === "1" ||
    useThickFlag?.toLowerCase() === "true";

  if (!useThick) return;

  try {
    if (libDir) {
      oracledb.initOracleClient({ libDir });
    } else {
      oracledb.initOracleClient();
    }
    oracleThickModeInitialized = true;
    console.log(
      `[Oracle] 已启用 Thick 模式（${libDir ? `libDir=${libDir}` : "系统默认库路径"}），适用于连接 Oracle 11g 等 Thin 不支持的版本`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Oracle Thick 初始化失败（检查 ORACLE_CLIENT_LIB_DIR / Instant Client 与位数是否与 Node 一致）：${msg}`
    );
  }
}

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
 * Oracle 连接：`oracledb` 连接池。
 * - 默认 Thin（无需本机客户端），**不支持 11g** 等旧库。
 * - 连接 **11g**：设置环境变量启用 Thick，见 {@link ensureOracleThickModeFromEnv}。
 * 绑定参数请使用 `:1`、`:name` 等与驱动约定一致的占位符。
 */
export class OracleDbClient implements DbClient {
  private readonly poolPromise: Promise<Pool>;

  constructor(url: string | undefined) {
    ensureOracleThickModeFromEnv();
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
