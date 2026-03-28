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
      // 会员档案模板（bfcrm8）：无真库时便于联调 UI / 日志
      if (input.sql.includes("hyk_hyxx")) {
        return {
          rows: [
            {
              vipId: "1",
              memberCardNo: "DEMO8001",
              userName: "演示会员",
              cardTypeName: "普卡",
              mobile: "13900000000",
              storeName: "演示门店",
              registeTime: "2024-01-15T10:00:00Z"
            }
          ],
          rowCount: 1
        };
      }
      if (input.sql.includes("hyk_birthday_record")) {
        return {
          rows: [
            {
              vipId: "1",
              birthday: "1990-05-01",
              change_day: "2025-03-01"
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }
  }
  