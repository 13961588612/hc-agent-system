/**
 * 联调/排障：统一前缀 + 可选耗时，便于 grep `[Orchestrator]`、`[WeCom-WS]` 等。
 */
export function log(
  scope:
    | "[Orchestrator]"
    | "[Intent]"
    | "[DataQuery]"
    | "[WeCom-WS]"
    | "[WeCom-HTTP]"
    | unknown,
  phase: string,
  detail?: string,
  since?: number
): void {
  const ms = since !== undefined ? ` +${Date.now() - since}ms` : "";
  const d = detail ? ` | ${detail}` : "";
  const t = new Date().toISOString();
  console.log(`${scope} ${t} ${phase}${ms}${d}`);
}
