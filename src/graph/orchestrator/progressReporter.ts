type ProgressHandler = (message: string) => Promise<void> | void;

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
  await h(message);
}

export async function emitProgressByConfig(
  config: { configurable?: { thread_id?: string } } | undefined,
  message: string
): Promise<void> {
  await emitProgressByThreadId(config?.configurable?.thread_id, message);
}
