import type { DbClient, SqlQueryParams, SqlQueryResult } from "./dbClient.js";

export class DummyDbClient implements DbClient {
    async query(input: SqlQueryParams): Promise<SqlQueryResult> {
      console.log("[DummyDbClient] SQL:", input.sql, input.params ?? []);
      if (input.sql.includes("member_points")) {
        return {
          rows: [
            { change: 100, reason: "下单返积分", created_at: "2025-03-01T10:00:00Z" },
            { change: -20, reason: "兑换商品", created_at: "2025-03-05T14:00:00Z" }
          ],
          rowCount: 2
        };
      }
      if (input.sql.includes("orders")) {
        return {
          rows: [
            { order_id: "ORD001", status: "已发货", created_at: "2025-03-10T09:00:00Z" },
            { order_id: "ORD002", status: "待发货", created_at: "2025-03-12T11:00:00Z" }
          ],
          rowCount: 2
        };
      }
      return { rows: [], rowCount: 0 };
    }
  }
  