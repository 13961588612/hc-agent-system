/**
 * 运行期进度：仅通过 handler 推送到渠道（如企微流式），**不**写入 LangGraph State / checkpoint。
 * 节点内请使用 {@link emitProgressByConfig}，勿把进度条目标识放进持久化字段。
 */
type ProgressHandler = (threadId: string, message: string) => Promise<void> | void;

const handlers = new Map<string, ProgressHandler>();

export function registerProgressHandler(
  threadId: string,
  handler: ProgressHandler
): void {
  if (!threadId.trim()) return;
  handlers.set(threadId, handler);
}

export function unregisterProgressHandler(threadId: string): void {
  if (!threadId.trim()) return;
  handlers.delete(threadId);
}

export async function emitProgressByThreadId(
  threadId: string | undefined,
  message: string
): Promise<void> {
  const id = (threadId ?? "").trim();
  if (!id) return;
  const h = handlers.get(id);
  if (!h) return;
  await h(id, message);
}

export async function emitProgressByConfig(
  config: { configurable?: { thread_id?: string } } | undefined,
  message: string
): Promise<void> {
  await emitProgressByThreadId(config?.configurable?.thread_id, message);
}
