import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  IntentResultSchema,
  type IntentResult,
  type OrchestratorState
} from "../contracts/schemas.js";
import { listIntentRules } from "../intent/intentRuleRegistry.js";
import type { IntentRuleEntry } from "../intent/types.js";
import { getIntentLlmTimeoutMs } from "../config/intentPolicy.js";
import { logDebugStep } from "../infra/debugLog.js";
import { getModel } from "../model/index.js";

const INTENT_JSON_INSTRUCTION_BASE = `你是客服场景的意图分类器。根据用户最新一句（可结合简短对话上文）输出**仅一段 JSON 对象**，不要 markdown、不要解释。
字段要求：
- primaryIntent: "data_query" | "chitchat" | "unknown"
  - data_query：用户要查业务数据（订单、会员、积分、库存等）
  - chitchat：寒暄、感谢、与数据无关的闲聊
  - unknown：无法判断或超出当前助手能力
- needsClarification: boolean — 用户想查数但缺少关键条件（如未说明查谁、查哪段时间）时为 true
- clarificationQuestion: string — 仅当 needsClarification 为 true 时填写一句中文追问，否则省略或空字符串
- replySuggestion: string — 当 primaryIntent 为 chitchat 或 unknown 且不需要澄清时，给用户的简短友好中文回复（一两句）；data_query 且不需要澄清时可省略
- resolvedSlots: 对象 — 当 primaryIntent 为 data_query 时，填入已解析槽位，键名用英文 snake_case，例如 user_id、phone、order_id、time_range；未知则 {}
- dataQueryDomain: "member" | "ecommerce" | "other" | 省略 — 仅在 data_query 时填写：会员/积分/等级相关为 member；订单/物流为 ecommerce；否则 other
- targetIntent: string | 省略 — 仅在 data_query 时填写，优先使用「可用能力列表」中的 capability id
- missingSlots: string[] | 省略 — 仅在 data_query 且仍缺**执行查询必填**槽位时列出槽位名（如 ["user_id"]）；槽位已齐则 [] 或省略
- confidence: 0 到 1 之间的小数，可选

规则：
1. 若用户明显在问数据但信息不够，必须 needsClarification=true 并给出 clarificationQuestion；可同时列出 missingSlots。
2. data_query 且已能执行时：必须给出 dataQueryDomain、targetIntent，并在 resolvedSlots 中填入已提到的实体（如用户说的会员号、手机号可放在 phone 或 user_id）。`;

function intentRulePromptLine(r: IntentRuleEntry): string {
  const slots = (r.requiredSlots ?? []).join(",");
  const keywords = (r.triggerKeywords ?? []).join(",");
  return `- ${r.targetIntent} | rule=${r.id} | domain=${r.domain ?? "other"} | title=${r.title}${slots ? ` | requiredSlots=${slots}` : ""}${keywords ? ` | triggerKeywords=${keywords}` : ""}`;
}

function buildIntentInstructionFromRules(): string {
  const rules = listIntentRules();
  const lines = rules.map(intentRulePromptLine);
  const section = lines.length
    ? `\n\n可用能力列表（优先从下列 id 中选择 targetIntent）：\n${lines.join("\n")}`
    : `\n\n当前未发现能力列表；若是 data_query，可返回描述性 targetIntent。`;
  return `${INTENT_JSON_INSTRUCTION_BASE}${section}`;
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "object" && block !== null && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function safeJsonSnippet(input: unknown, maxLen = 1200): string {
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    if (!s) return "";
    return s.length > maxLen ? `${s.slice(0, maxLen)}...(truncated)` : s;
  } catch {
    return String(input ?? "");
  }
}

function defaultResolvedSlots(text: string): Record<string, unknown> {
  const resolvedSlots: Record<string, unknown> = {};
  const phone = text.match(/1\d{10}/)?.[0];
  if (phone) resolvedSlots.phone = phone;
  const card = text.match(/(?:卡号|会员卡)\s*[:：是为]?\s*([0-9A-Za-z]{6,32})/)?.[1];
  if (card) resolvedSlots.member_card = card;
  return resolvedSlots;
}

function extractSlotsByRule(
  rule: IntentRuleEntry,
  text: string,
  current: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...current };
  for (const x of rule.slotExtractors ?? []) {
    try {
      const m = text.match(new RegExp(x.regex, "i"));
      const v = m?.[1]?.trim();
      if (v) out[x.slot] = v;
    } catch {
      // 忽略坏 regex，保持兜底鲁棒性
    }
  }
  return out;
}

function scoreRule(rule: IntentRuleEntry, text: string): number {
  let score = rule.priority ?? 0;
  for (const k of rule.triggerKeywords ?? []) {
    if (k && text.includes(k.toLowerCase())) score += 3;
  }
  for (const r of rule.triggerRegex ?? []) {
    try {
      if (new RegExp(r, "i").test(text)) score += 4;
    } catch {
      // ignore invalid regex
    }
  }
  if (rule.domain === "member" && /会员|积分|卡号|手机号/.test(text)) score += 2;
  if (rule.domain === "ecommerce" && /订单|物流|快递/.test(text)) score += 2;
  return score;
}

function pickBestRule(text: string): IntentRuleEntry | undefined {
  const rules = listIntentRules();
  let best: IntentRuleEntry | undefined;
  let bestScore = 0;
  for (const r of rules) {
    const s = scoreRule(r, text);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best;
}

function slotValue(slots: Record<string, unknown>, name: string): unknown {
  const aliases: Record<string, string[]> = {
    memberCardNos: ["memberCardNos", "member_card", "memberCardNo", "hyk_no"],
    vipIds: ["vipIds", "user_id", "userId", "hyid"],
    mobiles: ["mobiles", "phone", "mobile", "sjhm"]
  };
  for (const k of aliases[name] ?? [name]) {
    const v = slots[k];
    if (v !== undefined && v !== null && String(v).trim()) return v;
  }
  return undefined;
}

function missingByRule(
  rule: IntentRuleEntry,
  slots: Record<string, unknown>
): string[] {
  return (rule.requiredSlots ?? []).filter((name) => !slotValue(slots, name));
}

function keywordFallbackIntent(userInput: string): IntentResult {
  const text = userInput.toLowerCase();
  const isDataQuery =
    text.includes("查") ||
    text.includes("查询") ||
    text.includes("订单") ||
    text.includes("积分") ||
    text.includes("会员");
  if (isDataQuery) {
    const rule = pickBestRule(text);
    const resolvedSlots = rule
      ? extractSlotsByRule(rule, userInput, defaultResolvedSlots(userInput))
      : defaultResolvedSlots(userInput);
    const missingSlots = rule ? missingByRule(rule, resolvedSlots) : [];
    const needsClarification = missingSlots.length > 0;
    const clarificationQuestion =
      needsClarification && rule?.clarificationTemplate
        ? rule.clarificationTemplate
        : needsClarification
          ? `请补充以下信息以便查询：${missingSlots.join("、")}`
          : undefined;
    return {
      primaryIntent: "data_query",
      needsClarification,
      resolvedSlots,
      dataQueryDomain: rule?.domain ?? "other",
      targetIntent: rule?.targetIntent,
      ...(missingSlots.length ? { missingSlots } : {}),
      ...(clarificationQuestion ? { clarificationQuestion } : {}),
      confidence: 0.5,
    };
  }
  return {
    primaryIntent: "unknown",
    needsClarification: false,
    replySuggestion: "如需查询订单或会员积分等数据，请直接说明您的需求。",
    resolvedSlots: {},
    confidence: 0.4
  };
}

function mapHighLevelDomain(intent: IntentResult): "data_query" | "other" {
  return intent.primaryIntent === "data_query" ? "data_query" : "other";
}

/**
 * LLM 结构化意图 + 关键词兜底；与 `highLevelDomain` 在同一出口对齐。
 */
export async function runIntentClassifyAgent(
  state: OrchestratorState
): Promise<Pick<OrchestratorState, "intentResult" | "highLevelDomain">> {
  const userInput = state.input.userInput;
  const tAll = Date.now();
  logDebugStep(
    "[Intent]",
    "classify 开始",
    `userInputLen=${userInput.length} historyTurns=${(state.conversationTurns ?? []).length}`
  );

  const historyLines = (state.conversationTurns ?? [])
    .slice(-10)
    .map((t) => `${t.role}: ${t.content}`);
  const historyBlock =
    historyLines.length > 0
      ? `【最近对话】\n${historyLines.join("\n")}\n\n`
      : "";

  try {
    const instruction = buildIntentInstructionFromRules();
    const tLlm = Date.now();
    const timeoutMs = getIntentLlmTimeoutMs();
    logDebugStep(
      "[Intent]",
      "getModel + LLM invoke 开始",
      `timeoutMs=${timeoutMs}`
    );
    const llm = getModel();
    const raw = await Promise.race([
      llm.invoke([
        new SystemMessage(instruction),
        new HumanMessage(`${historyBlock}【当前用户输入】\n${userInput}`)
      ]),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error("intent_llm_timeout")), timeoutMs);
      })
    ]);
    logDebugStep("[Intent]", "LLM invoke 结束（原始响应已收到）", undefined, tLlm);
    const text = messageContentToString(raw.content);
    const jsonStr = extractJsonObject(text);
    logDebugStep(
      "[Intent]",
      "LLM 原始结构化输出（截断）",
      safeJsonSnippet(jsonStr, 1000)
    );
    const parsed = JSON.parse(jsonStr) as unknown;
    const intent = IntentResultSchema.parse(parsed);
    logDebugStep(
      "[Intent]",
      "结构化字段评估",
      safeJsonSnippet(
        {
          primaryIntent: intent.primaryIntent,
          dataQueryDomain: intent.dataQueryDomain,
          targetIntent: intent.targetIntent,
          needsClarification: intent.needsClarification,
          missingSlots: intent.missingSlots ?? [],
          resolvedSlots: intent.resolvedSlots ?? {},
          confidence: intent.confidence
        },
        1200
      )
    );
    logDebugStep(
      "[Intent]",
      "classify 成功（JSON 已校验）",
      `primaryIntent=${intent.primaryIntent} needsClarification=${String(intent.needsClarification)} targetIntent=${intent.targetIntent ?? ""} dataQueryDomain=${intent.dataQueryDomain ?? ""} missingSlots=${(intent.missingSlots ?? []).join(",") || "none"}`,
      tAll
    );
    return { intentResult: intent, highLevelDomain: mapHighLevelDomain(intent) };
  } catch (e) {
    const intent = keywordFallbackIntent(userInput);
    const errMsg = e instanceof Error ? e.message : String(e);
    if (errMsg === "intent_llm_timeout") {
      logDebugStep("[Intent]", "LLM 超时 → 关键词兜底", `timeoutMs=${getIntentLlmTimeoutMs()}`, tAll);
    } else {
      logDebugStep(
        "[Intent]",
        "classify 失败 → 关键词兜底",
        `primaryIntent=${intent.primaryIntent} err=${errMsg.slice(0, 120)}`,
        tAll
      );
    }
    return { intentResult: intent, highLevelDomain: mapHighLevelDomain(intent) };
  }
}
