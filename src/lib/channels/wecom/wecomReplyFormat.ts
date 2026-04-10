import { getChannelReplyConfig } from "../../../config/channelReplyConfig.js";

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function getTableRenderConfig(): {
  maxRows: number;
  maxColumns: number;
  headerZhMap: Record<string, string>;
} {
  const tableCfg = getChannelReplyConfig().table;
  const maxRows =
    typeof tableCfg?.maxRows === "number" && Number.isFinite(tableCfg.maxRows)
      ? Math.max(1, Math.floor(tableCfg.maxRows))
      : 20;
  const maxColumns =
    typeof tableCfg?.maxColumns === "number" && Number.isFinite(tableCfg.maxColumns)
      ? Math.max(1, Math.floor(tableCfg.maxColumns))
      : 8;
  const headerZhMap =
    tableCfg?.headerZhMap && typeof tableCfg.headerZhMap === "object"
      ? tableCfg.headerZhMap
      : {};
  return { maxRows, maxColumns, headerZhMap };
}

function toMarkdownTable(
  rows: Array<Record<string, unknown>>,
  maxRows: number,
  maxColumns: number,
  headerZhMap: Record<string, string>
): string {
  if (!rows.length) return "未查询到数据。";
  const keys = Object.keys(rows[0] ?? {}).slice(0, maxColumns);
  if (!keys.length) return "查询完成，但结果字段为空。";
  const headers = keys.map((k, idx) => headerZhMap[k] || `列${idx + 1}(${k})`);
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, maxRows).map((r) => `| ${keys.map((k) => escapeCell(r[k])).join(" | ")} |`);
  const more = rows.length > maxRows ? `\n... 共 ${rows.length} 行，已展示前 ${maxRows} 行` : "";
  return [head, sep, ...body].join("\n") + more;
}

function formatDataQueryResultToTable(o: Record<string, unknown>): string | undefined {
  const { maxRows, maxColumns, headerZhMap } = getTableRenderConfig();
  const idx = o.resultsIndex;
  if (!idx || typeof idx !== "object") return undefined;
  const entries = Object.values(idx as Record<string, unknown>);
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const data = (e as Record<string, unknown>).data;
    if (!data || typeof data !== "object") continue;
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.tables) && d.tables.length > 0) {
      const first = d.tables[0];
      if (first && typeof first === "object" && Array.isArray((first as Record<string, unknown>).rows)) {
        return toMarkdownTable(
          (first as { rows: Array<Record<string, unknown>> }).rows,
          maxRows,
          maxColumns,
          headerZhMap
        );
      }
    }
    if (Array.isArray(d.rows)) {
      return toMarkdownTable(
        d.rows as Array<Record<string, unknown>>,
        maxRows,
        maxColumns,
        headerZhMap
      );
    }
  }
  return undefined;
}

/** 将编排 `finalAnswer` 转为可发送的文本（企微单条有长度限制，发送处再截断） */
export function formatFinalAnswerForChannel(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (o.type === "fallback" && typeof o.message === "string") return o.message;
    if (o.type === "clarification" && typeof o.message === "string") return o.message;
    if (o.type === "chitchat" && typeof o.message === "string") return o.message;
    if (o.type === "task_plan" && typeof o.message === "string") return o.message;
    if (o.type === "plan_blocked" && typeof o.message === "string") return o.message;
    if (o.type === "data_query") {
      const tableText = formatDataQueryResultToTable(o);
      if (tableText) return tableText;
      return "数据查询已完成，但暂无可展示表格。";
    }
  }
  return JSON.stringify(result, null, 2);
}
