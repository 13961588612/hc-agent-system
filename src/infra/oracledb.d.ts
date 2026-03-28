/**
 * node-oracledb 运行时自带类型不完整时，由本模块提供最小声明以通过编译。
 * @see https://oracle.github.io/node-oracledb/
 */
declare module "oracledb" {
  export interface Pool {
    getConnection(): Promise<Connection>;
    close(): Promise<void>;
  }

  export interface Connection {
    execute(
      sql: string,
      binds: unknown[] | Record<string, unknown> | undefined,
      options?: { outFormat?: number }
    ): Promise<{ rows?: unknown[] }>;
    close(): Promise<void>;
  }

  export interface PoolAttributes {
    user?: string;
    password?: string;
    connectString?: string;
  }

  export function createPool(config: PoolAttributes): Promise<Pool>;

  export const OUT_FORMAT_OBJECT: number;

  interface OracledbStatic {
    createPool(config: PoolAttributes): Promise<Pool>;
    OUT_FORMAT_OBJECT: number;
    /** Thick 模式：连接 11g 等 Thin 不支持的库前必须调用 */
    initOracleClient(options?: { libDir?: string }): void;
  }

  const oracledb: OracledbStatic;
  export default oracledb;
}
