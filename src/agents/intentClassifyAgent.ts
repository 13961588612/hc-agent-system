import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod/v3";
import type { OrchestratorState } from "../contracts/schemas.js";
import {
  getIntentResultSchema,
  type IntentResult
} from "../contracts/intentSchemas.js";
import {
  getSystemConfig,
  listBusinessSegmentIds,
  listSkillsDomains,
  listSkillsSegments,
  listSystemModuleDomains
} from "../config/systemConfig.js";
import { listIntentRules } from "../intent/intentRuleRegistry.js";
import type { IntentRuleEntry } from "../intent/types.js";
import { getIntentLlmTimeoutMs } from "../config/intentPolicy.js";
import { log } from "../lib/log/log.js";
import { getModel } from "../model/index.js";
import {
  invokeSkillTool,
  listSkillsByDomainSegmentTool,
  runInvokeSkillTool,
  runListSkillsByDomainSegmentTool
} from "../lib/tools/skillsTools.js";

const IntentEnumSchema = z.enum([
  "data_query",
  "data_analysis",
  "knowledge_qa",
  "chitchat",
  "unknown"
]);

const IntentLlmOutputSchema = z.object({
  intents: z
    .array(
      z.object({
        intent: IntentEnumSchema,
        goal: z.string().nullable().default(null),
        confidence: z.number().nullable().default(null),
        executable: z.boolean().nullable().default(null),
        needsClarification: z.boolean().nullable().default(null),
        clarificationQuestion: z.string().nullable().default(null),
        resolvedSlots: z.record(z.unknown()).nullable().default(null),
        dataQueryDomain: z.string().nullable().default(null),
        targetIntent: z.string().nullable().default(null),
        missingSlots: z.array(z.string()).default([]),
        replySuggestion: z.string().nullable().default(null)
      })
    )
    .default([]),
  planPhase: z.enum(["draft", "blocked", "ready"]).default("draft"),
  replyLocale: z.enum(["zh", "en", "auto"]).default("auto"),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().nullable().default(null),
  confidence: z.number().nullable().default(null),
  replySuggestion: z.string().nullable().default(null),
  planningTasks: z
    .array(
      z.object({
        taskId: z.string(),
        systemModuleId: z.string(),
        goal: z.string(),
        resolvedSlots: z.record(z.unknown()).nullable().default(null),
        missingSlots: z.array(z.string()).default([]),
        clarificationQuestion: z.string().nullable().default(null),
        executable: z.boolean().nullable().default(null),
        skillSteps: z
          .array(
            z.object({
              stepId: z.string(),
              skillsDomainId: z.string(),
              skillsSegmentId: z.string().nullable().default(null),
              disclosedSkillIds: z.array(z.string()).default([]),
              selectedCapability: z
                .object({
                  kind: z.enum(["skill", "guide"]),
                  id: z.string()
                })
                .nullable()
                .default(null),
              requiredParams: z.array(z.string()).default([]),
              providedParams: z.record(z.unknown()).nullable().default(null),
              missingParams: z.array(z.string()).default([]),
              executable: z.boolean().nullable().default(null),
              expectedOutput: z.enum(["table", "object", "summary"]).nullable().default(null)
            })
          )
          .default([])
      })
    )
    .default([])
});

function buildIntentJsonInstructionBase(): string {
  const cfg = getSystemConfig();
  const segmentIds = listBusinessSegmentIds(cfg);
  const domainLiteral = segmentIds.map((id) => `"${id}"`).join(", ");
  const moduleIds = listSystemModuleDomains(cfg).map((d) => d.id);
  const skillsDomainIds = listSkillsDomains(cfg).map((d) => d.id);
  const skillsSegmentIds = listSkillsSegments(cfg).map((s) => s.id);
  return `你是客服场景的多意图识别与任务拆解器。
必须遵循 skill「intent-common」作为唯一规则来源。

输出要求（强约束）：
1) 只输出一个 JSON 对象，不要 markdown/代码块/解释。
2) JSON 必须能通过当前代码的 IntentResultSchema 校验。
3) 必填核心字段至少包含：intents, planPhase, replyLocale, planningTasks, needsClarification。

动态枚举约束（以当前系统配置为准）：
- dataQueryDomain 仅可取：${domainLiteral || "other"}
- planningTasks[].systemModuleId 优先取：${moduleIds.join(", ") || "data_query,data_analysis,knowledge_qa"}
- skillSteps[].skillsDomainId 可取：${skillsDomainIds.join(", ") || "core,data_query"}
- skillSteps[].skillsSegmentId 可取：${skillsSegmentIds.join(", ") || "member,ecommerce,other"}

一致性约束（必须满足）：
- 多意图允许并存，不要强制单意图。
- 若存在关键缺参：needsClarification=true，planPhase="blocked"，并给 clarificationQuestion。
- 若 data_query 可执行：至少一条 data_query 含 dataQueryDomain、targetIntent、resolvedSlots。
- taskPlan.nextAction 与是否缺参一致（execute / clarify）。
- 优先采用渐进式披露：先给 disclosedSkillIds，再收敛 selectedCapability.id。

工具使用要求（非常重要）：
- 先调用 list_skills_by_domain_segment（1~3组候选）做技能搜索，再调用 invoke_skill 查看候选详情。
- 必须基于工具结果填写 disclosedSkillIds 与 selectedCapability.id，不要凭空编造技能 id。
- 若工具结果不足以执行，返回 clarify 路径并说明缺失信息。`;
}

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
  return `${buildIntentJsonInstructionBase()}${section}`;
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

function toEnumIntent(v: unknown): "data_query" | "data_analysis" | "knowledge_qa" | "chitchat" | "unknown" {
  const s = String(v ?? "").trim();
  if (s === "data_query" || s === "data_analysis" || s === "knowledge_qa" || s === "chitchat" || s === "unknown") {
    return s;
  }
  if (s === "data-query" || s === "query" || s === "member_profile_query") return "data_query";
  if (s === "qa" || s === "knowledge") return "knowledge_qa";
  if (s === "chat" || s === "smalltalk") return "chitchat";
  return "unknown";
}

function normalizePlanPhase(v: unknown): "draft" | "blocked" | "ready" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "ready" || s === "blocked" || s === "draft") return s;
  if (s === "execute" || s === "executable") return "ready";
  if (s === "clarify" || s === "need_clarify") return "blocked";
  return "draft";
}

function normalizeReplyLocale(v: unknown): "zh" | "en" | "auto" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "zh" || s === "zh-cn" || s === "cn") return "zh";
  if (s === "en" || s === "en-us") return "en";
  return "auto";
}

function inferDominantIntentFromIntents(
  intents: Array<{ intent: "data_query" | "data_analysis" | "knowledge_qa" | "chitchat" | "unknown"; confidence?: number }>
): "data_query" | "data_analysis" | "knowledge_qa" | "chitchat" | "unknown" {
  if (!intents.length) return "unknown";
  return [...intents].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]?.intent ?? "unknown";
}

function normalizeIntentLikePayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const intentsRaw = Array.isArray(obj.intents) ? obj.intents : [];
  const intents = intentsRaw.map((it) => {
    const x = (it ?? {}) as Record<string, unknown>;
    const mappedIntent = toEnumIntent(x.intent ?? x.intentType);
    const targetIntent = x.targetIntent ?? x.intentId;
    return {
      intent: mappedIntent,
      ...(x.goal ? { goal: String(x.goal) } : {}),
      ...(typeof x.confidence === "number" ? { confidence: x.confidence } : {}),
      ...(typeof x.executable === "boolean" ? { executable: x.executable } : {}),
      ...(typeof x.needsClarification === "boolean" ? { needsClarification: x.needsClarification } : {}),
      ...(x.clarificationQuestion ? { clarificationQuestion: String(x.clarificationQuestion) } : {}),
      ...(x.resolvedSlots && typeof x.resolvedSlots === "object" ? { resolvedSlots: x.resolvedSlots } : {}),
      ...(x.dataQueryDomain ? { dataQueryDomain: String(x.dataQueryDomain) } : {}),
      ...(targetIntent ? { targetIntent: String(targetIntent) } : {}),
      ...(Array.isArray(x.missingSlots) ? { missingSlots: x.missingSlots } : {}),
      ...(x.replySuggestion ? { replySuggestion: String(x.replySuggestion) } : {})
    };
  });
  const planPhase = normalizePlanPhase(obj.planPhase);
  const needsClarification =
    typeof obj.needsClarification === "boolean"
      ? obj.needsClarification
      : planPhase === "blocked";
  return {
    ...obj,
    intents,
    planPhase,
    replyLocale: normalizeReplyLocale(obj.replyLocale),
    needsClarification
  };
}

function normalizeStructuredOutputToIntentPayload(
  data: z.infer<typeof IntentLlmOutputSchema>
): unknown {
  return {
    intents: data.intents.map((x) => ({
      intent: x.intent,
      ...(x.goal ? { goal: x.goal } : {}),
      ...(x.confidence !== null ? { confidence: x.confidence } : {}),
      ...(x.executable !== null ? { executable: x.executable } : {}),
      ...(x.needsClarification !== null ? { needsClarification: x.needsClarification } : {}),
      ...(x.clarificationQuestion ? { clarificationQuestion: x.clarificationQuestion } : {}),
      ...(x.resolvedSlots ? { resolvedSlots: x.resolvedSlots } : {}),
      ...(x.dataQueryDomain ? { dataQueryDomain: x.dataQueryDomain } : {}),
      ...(x.targetIntent ? { targetIntent: x.targetIntent } : {}),
      ...(x.missingSlots.length ? { missingSlots: x.missingSlots } : {}),
      ...(x.replySuggestion ? { replySuggestion: x.replySuggestion } : {})
    })),
    planPhase: data.planPhase,
    replyLocale: data.replyLocale,
    needsClarification: data.needsClarification,
    ...(data.clarificationQuestion ? { clarificationQuestion: data.clarificationQuestion } : {}),
    ...(data.confidence !== null ? { confidence: data.confidence } : {}),
    ...(data.replySuggestion ? { replySuggestion: data.replySuggestion } : {}),
    planningTasks: data.planningTasks.map((t) => ({
      taskId: t.taskId,
      systemModuleId: t.systemModuleId,
      goal: t.goal,
      ...(t.resolvedSlots ? { resolvedSlots: t.resolvedSlots } : {}),
      ...(t.missingSlots.length ? { missingSlots: t.missingSlots } : {}),
      ...(t.clarificationQuestion ? { clarificationQuestion: t.clarificationQuestion } : {}),
      ...(t.executable !== null ? { executable: t.executable } : {}),
      ...(t.skillSteps.length
        ? {
            skillSteps: t.skillSteps.map((s) => ({
              stepId: s.stepId,
              skillsDomainId: s.skillsDomainId,
              ...(s.skillsSegmentId ? { skillsSegmentId: s.skillsSegmentId } : {}),
              ...(s.disclosedSkillIds.length ? { disclosedSkillIds: s.disclosedSkillIds } : {}),
              ...(s.selectedCapability ? { selectedCapability: s.selectedCapability } : {}),
              ...(s.requiredParams.length ? { requiredParams: s.requiredParams } : {}),
              ...(s.providedParams ? { providedParams: s.providedParams } : {}),
              ...(s.missingParams.length ? { missingParams: s.missingParams } : {}),
              ...(s.executable !== null ? { executable: s.executable } : {}),
              ...(s.expectedOutput ? { expectedOutput: s.expectedOutput } : {})
            }))
          }
        : {})
    }))
  };
}

async function runIntentWithSkillTools(
  systemInstruction: string,
  userPrompt: string
): Promise<unknown> {
  const llm = getModel();
  const bindTools = (llm as { bindTools?: (tools: unknown[]) => { invoke: (x: unknown) => Promise<unknown> } })
    .bindTools;
  if (!bindTools) {
    return llm.invoke([new SystemMessage(systemInstruction), new HumanMessage(userPrompt)]);
  }
  const modelWithTools = bindTools.call(llm, [
    listSkillsByDomainSegmentTool,
    invokeSkillTool
  ]);

  console.log("modelWithTools ->", JSON.stringify(modelWithTools, null, 2));

  const systemMessage = new SystemMessage(systemInstruction);
  console.log("systemMessage ->", JSON.stringify(systemMessage, null, 2));
  const humanMessage = new HumanMessage(userPrompt);
  console.log("humanMessage ->", JSON.stringify(humanMessage, null, 2));

  const messages: Array<SystemMessage | HumanMessage | ToolMessage | { content: unknown; tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }> = [
    systemMessage,
    humanMessage
  ];
  for (let i = 0; i < 20; i++) {
    const aiMsg = (await modelWithTools.invoke(messages)) as {
      content: unknown;
      tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
    };

    console.log("aiMsg ->", JSON.stringify(aiMsg, null, 2));

    messages.push(aiMsg);
    const calls = aiMsg.tool_calls ?? [];
    if (calls.length === 0) return aiMsg;
    for (let j = 0; j < calls.length; j++) {
      const c = calls[j]!;
      const name = c.name ?? "";
      const args = c.args ?? {};
      let toolResult = JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
      try {
        if (name === "list_skills_by_domain_segment") {
          toolResult = await runListSkillsByDomainSegmentTool(
            String(args["domainId"] ?? ""),
            String(args["segmentId"] ?? "")
          );
        } else if (name === "invoke_skill") {
          toolResult = await runInvokeSkillTool(String(args["skillId"] ?? ""));
        }
      } catch (e) {
        toolResult = JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        });
      }
      messages.push(
        new ToolMessage({
          tool_call_id: c.id ?? `call_${i}_${j}`,
          content: toolResult
        })
      );
    }
  }
  throw new Error("intent_tool_call_exceeded");
}

async function runIntentWithStructuredOutput(
  systemInstruction: string,
  userPrompt: string,
  toolContext: string
): Promise<z.infer<typeof IntentLlmOutputSchema>> {
  const llm = getModel().withStructuredOutput(IntentLlmOutputSchema);
  const out = await llm.invoke([
    new SystemMessage(
      `${systemInstruction}\n\n请基于下方“工具阶段结果”返回最终结构化意图。若工具结果不足，走 blocked/clarify。`
    ),
    new HumanMessage(`${userPrompt}\n\n【工具阶段结果】\n${toolContext}`)
  ]);
  return IntentLlmOutputSchema.parse(out);
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

/** 兜底/无规则时写入合法的 `dataQueryDomain`（须在 `listQuerySegmentIds` 内） */
function coerceDataQueryDomain(ruleDomain: string | undefined): string {
  const ids = listBusinessSegmentIds(getSystemConfig());
  const d = ruleDomain?.trim();
  if (d && ids.includes(d)) return d;
  if (ids.includes("other")) return "other";
  return ids[0] ?? "other";
}

function keywordFallbackIntent(userInput: string): IntentResult {
  void userInput;
  // 保留空兜底：不做关键词推断，仅返回最小澄清结果。
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
    planPhase: "blocked",
    replyLocale: "auto",
    planningTasks: [
      {
        taskId: "task-1",
        systemModuleId: "knowledge_qa",
        goal: "识别用户真实需求并澄清",
        executable: false,
        missingSlots: ["user_goal"],
        clarificationQuestion: "请说明你希望查询或分析的具体对象与时间范围。",
        expectedOutput: "summary",
        followUpActions: [{ type: "reply_channel" }]
      }
    ],
    needsClarification: true,
    clarificationQuestion: "请说明你希望查询或分析的具体对象与时间范围。",
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

function normalizePlanning(intent: IntentResult): IntentResult {
  if (intent.planPhase && intent.planningTasks) return intent;
  const primary = intent.intents[0];
  const dominantIntent = inferDominantIntentFromIntents(intent.intents);
  const inferredTask = {
    taskId: "task-1",
    systemModuleId:
      dominantIntent === "data_analysis"
        ? "data_analysis"
        : dominantIntent === "knowledge_qa"
          ? "knowledge_qa"
          : "data_query",
    goal: primary?.goal ?? "执行任务",
    executable: !intent.needsClarification,
    missingSlots: primary?.missingSlots ?? [],
    clarificationQuestion: intent.clarificationQuestion,
    expectedOutput: "summary" as const
  };
  return {
    ...intent,
    planPhase: intent.needsClarification ? "blocked" : "ready",
    replyLocale: intent.replyLocale ?? "auto",
    planningTasks: intent.planningTasks?.length ? intent.planningTasks : [inferredTask]
  };
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
    const raw = await Promise.race([
      runIntentWithSkillTools(instruction, `${historyBlock}【当前用户输入】\n${userInput}`),
      new Promise<never>((_, rej) => {
        setTimeout(() => rej(new Error("intent_llm_timeout")), timeoutMs);
      })
    ]);
    log("[Intent]", "LLM invoke 结束（原始响应已收到）", undefined, tLlm);
    const rawMsg = raw as { content?: unknown; tool_calls?: unknown };
    log(
      "[Intent]",
      "LLM 原始返回（content + tool_calls）",
      safeJsonSnippet(
        {
          content: rawMsg.content,
          tool_calls: rawMsg.tool_calls
        },
        20000
      )
    );
    const toolPhaseText = messageContentToString((raw as { content: unknown }).content);
    const structured = await runIntentWithStructuredOutput(
      instruction,
      `${historyBlock}【当前用户输入】\n${userInput}`,
      toolPhaseText
    );
    log("[Intent]", "LLM withStructuredOutput 结果（截断）", safeJsonSnippet(structured, 1200));
    const normalizedParsed = normalizeIntentLikePayload(
      normalizeStructuredOutputToIntentPayload(structured)
    );
    const intent = normalizePlanning(getIntentResultSchema().parse(normalizedParsed));
    log(
      "[Intent]",
      "结构化字段评估",
      safeJsonSnippet(
        {
          dominantIntent: inferDominantIntentFromIntents(intent.intents),
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
      `dominantIntent=${inferDominantIntentFromIntents(intent.intents)} intents=${intent.intents.length} needsClarification=${String(intent.needsClarification)}`,
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
        `dominantIntent=${inferDominantIntentFromIntents(intent.intents)} err=${errMsg.slice(0, 120)}`,
        tAll
      );
    }
    return { intentResult: intent, highLevelDomain: mapHighLevelDomain(intent) };
  }
}
