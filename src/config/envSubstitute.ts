/**
 * 配置文件中 `${VAR}` 占位符展开为环境变量（与 `databases.yaml` 中连接串约定一致）。
 * 仅支持大写字母、数字、下划线组成的变量名，与 `process.env` 对齐。
 */

/** `${VAR}` → `process.env.VAR`（未定义则替换为空串） */
export function substituteEnvInString(s: string): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

/** 对字符串值做占位符展开；非字符串原样返回 */
export function substituteEnvInUnknown(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return substituteEnvInString(value);
}
