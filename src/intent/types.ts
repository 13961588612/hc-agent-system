export type IntentRuleDomain = "member" | "ecommerce" | "other";

export interface IntentRuleSlotExtractor {
  /** 目标槽位名（写入 `resolvedSlots` 的 key） */
  slot: string;
  /** 提取规则（JS 正则字符串），建议至少包含一个捕获组用于取值 */
  regex: string;
}

export interface IntentRuleEntry {
  /** 规则唯一 id（注册表键） */
  id: string;
  /** 规则类型，当前固定为 `intent_rule` */
  kind: "intent_rule";
  /** 人类可读标题，用于调试日志与运维定位 */
  title: string;
  /** 问数域（member/ecommerce/other） */
  domain?: IntentRuleDomain;
  /** 命中后写入 `IntentResult.targetIntent` 的稳定能力 id */
  targetIntent: string;
  /** 关键词触发（简单包含匹配） */
  triggerKeywords?: string[];
  /** 正则触发（复杂语义匹配） */
  triggerRegex?: string[];
  /** 执行该意图所需的最小槽位名集合 */
  requiredSlots?: string[];
  /** 命中后可执行的槽位抽取规则 */
  slotExtractors?: IntentRuleSlotExtractor[];
  /** 缺参时优先使用的追问模板 */
  clarificationTemplate?: string;
  /** 优先级（同分时用于抬权） */
  priority?: number;
  /** 规则来源文件路径 */
  filePath: string;
}
