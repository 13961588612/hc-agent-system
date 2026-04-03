import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  IntentResultSchema,
  type IntentResult,
  type OrchestratorState
} from "../contracts/schemas.js";
import { listIntentRules } from "../intent/intentRuleRegistry.js";
import type { IntentRuleEntry } from "../intent/types.js";
import { getIntentLlmTimeoutMs } from "../config/intentPolicy.js";
import { log } from "../lib/log/log.js";
import { getModel } from "../model/index.js";

const INTENT_JSON_INSTRUCTION_BASE = `你是客服场景的多意图识别与任务拆解器。根据用户最新一句（可结合简短对话上文）输出**仅一段 JSON 对象**，不要 markdown、不要解释。
字段要求（必须遵循）：
- intents: 数组，至少 1 项。每项结构：
  - intent: "data_query" | "data_analysis" | "knowledge_qa" | "chitchat" | "unknown"
  - goal: string（该子意图要完成的目标）
  - confidence: 0~1（可选）
  - executable: boolean（可选）
  - needsClarification: boolean（可选）
  - clarificationQuestion: string（该子意图缺参时的追问，可选）
  - data_query 子意图可选字段：
    - resolvedSlots: 对象，键名建议 snake_case
    - dataQueryDomain: "member" | "ecommerce" | "other"
    - targetIntent: string（优先用可用能力列表 id）
    - missingSlots: string[]
  - 非问数子意图可给 replySuggestion（可选）
- dominantIntent: 同上 intent 枚举之一，表示本轮主导意图（用于路由优先级）
- needsClarification: boolean（全局是否需要先澄清）
- clarificationQuestion: string（全局追问句；若 needsClarification=true 必填）
- replySuggestion: string（当主要是 chitchat/unknown 时可填）
- confidence: 0~1（全局，可选）
- taskPlan: object（可选）：
  - domainSegmentRanking: [{ domain, segment, score?, reason? }]
  - subTasks: [{ taskId, goal, selectedEntry?, executable, requiredParams?, providedParams?, missingParams?, plan?, expectedOutput? }]
  - missingParamsSummary: string[]
  - nextAction: "execute" | "clarify"
  - finalSummary: string

规则：
1. 一个问题可同时输出多个意图；不要强制压成单意图。
2. 只要任一关键子任务缺参数且无法执行，needsClarification=true，并给全局 clarificationQuestion。
3. 若存在 data_query 且可执行，至少一条 data_query 子意图必须给 dataQueryDomain、targetIntent、resolvedSlots。`;

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
      intents: [
        {
          intent: "data_query",
          goal: "执行数据查询",
          confidence: 0.5,
          executable: !needsClarification,
          needsClarification,
          ...(clarificationQuestion ? { clarificationQuestion } : {}),
          resolvedSlots,
          dataQueryDomain: rule?.domain ?? "other",
          targetIntent: rule?.targetIntent,
          ...(missingSlots.length ? { missingSlots } : {})
        }
      ],
      dominantIntent: "data_query",
      needsClarification,
      ...(clarificationQuestion ? { clarificationQuestion } : {}),
      taskPlan: {
        domainSegmentRanking: [
          {
            domain: rule?.domain ?? "other",
            segment: rule?.domain ?? "other",
            score: 0.5,
            reason: rule ? `匹配规则 ${rule.id}` : "关键词兜底命中"
          }
        ],
        subTasks: [
          {
            taskId: "task-1",
            goal: "执行数据查询",
            selectedEntry: rule?.targetIntent
              ? { kind: "guide", id: rule.targetIntent }
              : undefined,
            executable: !needsClarification,
            requiredParams: rule?.requiredSlots ?? [],
            providedParams: resolvedSlots,
            missingParams: missingSlots,
            plan: needsClarification
              ? undefined
              : ["按目标意图构造查询入参", "执行数据查询子图并返回结果"],
            expectedOutput: "table"
          }
        ],
        missingParamsSummary: missingSlots,
        nextAction: needsClarification ? "clarify" : "execute",
        finalSummary: needsClarification
          ? "存在缺失参数，需先澄清后执行。"
          : "参数满足，可执行数据查询。"
      },
      confidence: 0.5,
    } satisfies IntentResult;
  }
  return {
    intents: [
      {
        intent: "unknown",
        goal: "识别用户意图并请求澄清",
        confidence: 0.4,
        executable: false,
        replySuggestion: "如需查询订单或会员积分等数据，请直接说明您的需求。"
      }
    ],
    dominantIntent: "unknown",
    needsClarification: false,
    replySuggestion: "如需查询订单或会员积分等数据，请直接说明您的需求。",
    taskPlan: {
      domainSegmentRanking: [],
      subTasks: [],
      missingParamsSummary: [],
      nextAction: "clarify",
      finalSummary: "未识别为可执行数据查询，请先澄清需求。"
    },
    confidence: 0.4
  } satisfies IntentResult;
}

function mapHighLevelDomain(intent: IntentResult): "data_query" | "other" {
  return intent.intents.some((x) => x.intent === "data_query") ? "data_query" : "other";
}

/**
 * LLM 结构化意图 + 关键词兜底；与 `highLevelDomain` 在同一出口对齐。
 */
export async function runIntentClassifyAgent(
  state: OrchestratorState
): Promise<Pick<OrchestratorState, "intentResult" | "highLevelDomain">> {
  const userInput = state.input.userInput;
  const tAll = Date.now();
  log(
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
    log(
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
    log("[Intent]", "LLM invoke 结束（原始响应已收到）", undefined, tLlm);
    const text = messageContentToString(raw.content);
    const jsonStr = extractJsonObject(text);
    log(
      "[Intent]",
      "LLM 原始结构化输出（截断）",
      safeJsonSnippet(jsonStr, 1000)
    );
    const parsed = JSON.parse(jsonStr) as unknown;
    const intent = IntentResultSchema.parse(parsed);
    log(
      "[Intent]",
      "结构化字段评估",
      safeJsonSnippet(
        {
          dominantIntent: intent.dominantIntent,
          intents: intent.intents.map((x) => ({
            intent: x.intent,
            executable: x.executable,
            dataQueryDomain: x.dataQueryDomain,
            targetIntent: x.targetIntent,
            missingSlots: x.missingSlots ?? []
          })),
          needsClarification: intent.needsClarification,
          confidence: intent.confidence
        },
        1200
      )
    );
    log(
      "[Intent]",
      "classify 成功（JSON 已校验）",
      `dominantIntent=${intent.dominantIntent} intents=${intent.intents.length} needsClarification=${String(intent.needsClarification)}`,
      tAll
    );
    return { intentResult: intent, highLevelDomain: mapHighLevelDomain(intent) };
  } catch (e) {
    const intent = keywordFallbackIntent(userInput);
    const errMsg = e instanceof Error ? e.message : String(e);
    if (errMsg === "intent_llm_timeout") {
      log("[Intent]", "LLM 超时 → 关键词兜底", `timeoutMs=${getIntentLlmTimeoutMs()}`, tAll);
    } else {
      log(
        "[Intent]",
        "classify 失败 → 关键词兜底",
        `dominantIntent=${intent.dominantIntent} err=${errMsg.slice(0, 120)}`,
        tAll
      );
    }
    return { intentResult: intent, highLevelDomain: mapHighLevelDomain(intent) };
  }
}
