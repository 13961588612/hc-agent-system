/**
 * 联调/排障：统一前缀 + 可选耗时，便于 grep `[Orchestrator]`、`[WeCom-WS]` 等。
 */
export function logDebugStep(
  scope:
    | "[Orchestrator]"
    | "[Intent]"
    | "[DataQuery]"
    | "[WeCom-WS]"
    | "[WeCom-HTTP]",
  phase: string,
  detail?: string,
  since?: number
): void {
  const ms = since !== undefined ? ` +${Date.now() - since}ms` : "";
  const d = detail ? ` | ${detail}` : "";
  console.log(`${scope} ${phase}${ms}${d}`);
}
