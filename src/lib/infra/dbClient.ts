export interface SqlQueryParams {
  sql: string;
  params?: unknown[];
}

export interface SqlRow {
  [key: string]: unknown;
}

export interface SqlQueryResult {
  rows: SqlRow[];
  rowCount: number;
}

export interface DbClient {
  query(input: SqlQueryParams): Promise<SqlQueryResult>;
}

export { DummyDbClient } from "./dummyDbClient.js";

