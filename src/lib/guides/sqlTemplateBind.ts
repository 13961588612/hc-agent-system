/** 从正文截取 capability 小节（三级标题带反引号 id）中首个 sql 围栏代码块 */
export function extractCapabilitySqlTemplate(
  body: string,
  capabilityId: string
): string | undefined {
  const marker = `### \`${capabilityId}\``;
  const start = body.indexOf(marker);
  if (start < 0) return undefined;
  const after = body.slice(start + marker.length);
  const nextH3 = after.search(/^###\s+/m);
  const section = nextH3 >= 0 ? after.slice(0, nextH3) : after;
  const fence = section.match(/```sql\s*([\s\S]*?)```/i);
  return fence?.[1]?.trim();
}

/** 单文件单 skill 模式：直接读取正文中首个 sql 围栏代码块 */
export function extractFirstSqlTemplate(body: string): string | undefined {
  const fence = body.match(/```sql\s*([\s\S]*?)```/i);
  return fence?.[1]?.trim();
}

/** 将模板中第一处「IN + 括号内块注释占位」替换为 IN（:1,:2,…）并返回绑定数组 */
const IN_COMMENT_BLOCK = /IN\s*\(\s*\/\*[\s\S]*?\*\/\s*\)/;

export function bindFirstInClause(
  sql: string,
  values: unknown[]
): { sql: string; params: unknown[] } {
  if (values.length === 0) {
    throw new Error("bindFirstInClause: values 不能为空");
  }
  const placeholders = values.map((_, i) => `:${i + 1}`).join(", ");
  const replaced = sql.replace(IN_COMMENT_BLOCK, `IN (${placeholders})`);
  if (replaced === sql) {
    throw new Error("bindFirstInClause: 未找到可替换的 IN 占位块");
  }
  return { sql: replaced, params: [...values] };
}

/** 若 SQL 含「IN + 括号内块注释占位」则展开为多占位符；否则假定已写 :1 等与 values 顺序一致，直接绑定 */
export function bindSqlTemplate(
  sql: string,
  values: unknown[]
): { sql: string; params: unknown[] } {
  if (values.length === 0) {
    throw new Error("bindSqlTemplate: values 不能为空");
  }
  if (IN_COMMENT_BLOCK.test(sql)) {
    return bindFirstInClause(sql, values);
  }
  return { sql, params: [...values] };
}
