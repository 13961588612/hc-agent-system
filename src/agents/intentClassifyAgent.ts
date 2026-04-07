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
  listBusinessSegments,
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
        domainId: z.string().nullable().default(null),
        segmentId: z.string().nullable().default(null),
        targetEntryId: z.string().nullable().default(null),
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

/** 从 system.yaml 注入到意图识别提示词中的系统摘要（只读配置，不写死业务） */
function formatSystemContextForIntentPrompt(): string {
  const cfg = getSystemConfig();
  const ver =
    typeof cfg.version === "number" && Number.isFinite(cfg.version)
      ? String(cfg.version)
      : "—";

  const modules = listSystemModuleDomains(cfg);
  const moduleBlock = modules.length
    ? modules
        .map(
          (m) =>
            `  - systemModuleId="${m.id}"${m.title ? ` 标题：${m.title}` : ""}${m.description ? ` | 说明：${m.description}` : ""}`
        )
        .join("\n")
    : "  - （当前配置未声明 system-module 域，planningTasks[].systemModuleId 仍须与 intents 语义一致，可用 data_query / data_analysis / knowledge_qa 等稳定 id）";

  const business = listBusinessSegments(cfg);
  const businessBlock = business.length
    ? business
        .map(
          (s) =>
            `  - segmentId="${s.id}"${s.title ? ` 标题：${s.title}` : ""}${s.description ? ` | ${s.description}` : ""}`
        )
        .join("\n")
    : "  - （无 business 分段，segmentId 可用 other 或与技能披露一致）";

  const skillDomains = listSkillsDomains(cfg);
  const skillDomBlock = skillDomains.length
    ? skillDomains.map((d) => `  - skillsDomainId="${d.id}"${d.title ? `（${d.title}）` : ""}`).join("\n")
    : "  - （无 skills 域配置）";

  const skillSegs = listSkillsSegments(cfg);
  const skillSegBlock = skillSegs.length
    ? skillSegs.map((s) => `  - skillsSegmentId="${s.id}"${s.title ? `（${s.title}）` : ""}`).join("\n")
    : "  - （无 skills 分段配置）";

  return `【当前系统信息】（来自 getSystemConfig / config/system.yaml，须据此约束输出）
- 配置 version：${ver}
- 系统模块（facet=system-module，意图任务 planningTasks 必须按 systemModuleId 与此列表对齐）：
${moduleBlock}
- 业务分段（facet=business，用于 intents[].segmentId 等）：
${businessBlock}
- 技能顶层域（facet=skills，用于 skillSteps[].skillsDomainId）：
${skillDomBlock}
- 技能分段（facet=skills，用于 skillSteps[].skillsSegmentId）：
${skillSegBlock}`;
}

function buildIntentJsonInstructionBase(): string {
  const cfg = getSystemConfig();
  const segmentIds = listBusinessSegmentIds(cfg);
  const domainLiteral = segmentIds.map((id) => `"${id}"`).join(", ");
  const moduleIds = listSystemModuleDomains(cfg).map((d) => d.id);
  const skillsDomainIds = listSkillsDomains(cfg).map((d) => d.id);
  const skillsSegmentIds = listSkillsSegments(cfg).map((s) => s.id);
  const systemContext = formatSystemContextForIntentPrompt();
  return `你是客服场景的多意图识别与任务拆解器。
使用 skill「intent-common」来识别意图，使用invoke_skill来执行技能。

${systemContext}

【任务切分】planningTasks 必须按 systemModuleId 拆分：
- 用户一句里若涉及多个系统模块能力，应输出多条 planningTasks，每条对应一个 systemModuleId，且 taskId 互不重复。
- 每条 planningTasks[].systemModuleId 必须是上表「系统模块」中的 id；若表为空则使用与业务一致的稳定 id（如 data_query）。
- 同一条 planningTask 内 skillSteps 仅服务该 systemModuleId，不要把不同模块的步骤混在同一 task 里。

输出要求（强约束）：
1) 只输出一个 JSON 对象，不要 markdown/代码块/解释。
2) JSON 必须能通过当前代码的 IntentResultSchema 校验。
3) 必填核心字段至少包含：intents, planPhase, replyLocale, planningTasks, needsClarification。

动态枚举约束（以当前系统配置为准）：
- segmentId 仅可取：${domainLiteral || "other"}
- planningTasks[].systemModuleId 优先取：${moduleIds.join(", ") || "data_query,data_analysis,knowledge_qa"}
- skillSteps[].skillsDomainId 可取：${skillsDomainIds.join(", ") || "core,data_query"}
- skillSteps[].skillsSegmentId 可取：${skillsSegmentIds.join(", ") || "member,ecommerce,other"}

一致性约束（必须满足）：
- 多意图允许并存，不要强制单意图。
- 若存在关键缺参：needsClarification=true，planPhase="blocked"，并给 clarificationQuestion。
- 若存在可执行项：至少一条子意图含 domainId、segmentId、targetEntryId、resolvedSlots。
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
    ? `\n\n可用能力列表（优先从下列 id 中选择 targetEntryId）：\n${lines.join("\n")}`
    : `\n\n当前未发现能力列表；可返回描述性 targetEntryId。`;
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
    const targetEntryId = x.targetEntryId ?? x.targetIntent ?? x.intentId;
    return {
      intent: mappedIntent,
      ...(x.goal ? { goal: String(x.goal) } : {}),
      ...(typeof x.confidence === "number" ? { confidence: x.confidence } : {}),
      ...(typeof x.executable === "boolean" ? { executable: x.executable } : {}),
      ...(typeof x.needsClarification === "boolean" ? { needsClarification: x.needsClarification } : {}),
      ...(x.clarificationQuestion ? { clarificationQuestion: String(x.clarificationQuestion) } : {}),
      ...(x.resolvedSlots && typeof x.resolvedSlots === "object" ? { resolvedSlots: x.resolvedSlots } : {}),
      ...(x.domainId ? { domainId: String(x.domainId) } : {}),
      ...(x.segmentId
        ? { segmentId: String(x.segmentId) }
        : x.dataQueryDomain
          ? { segmentId: String(x.dataQueryDomain) }
          : {}),
      ...(targetEntryId ? { targetEntryId: String(targetEntryId) } : {}),
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
      ...(x.domainId ? { domainId: x.domainId } : {}),
      ...(x.segmentId ? { segmentId: x.segmentId } : {}),
      ...(x.targetEntryId ? { targetEntryId: x.targetEntryId } : {}),
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

/** 探测 bindTools 后模型上是否挂上 tools（LangChain 版本差异下字段可能在 kwargs 等位置） */
function describeLlmToolBinding(model: unknown): string {
  if (!model || typeof model !== "object") return "失败：绑定结果非对象";
  const o = model as Record<string, unknown>;
  if (typeof o.invoke !== "function") return "失败：无 invoke，不是可调用 Runnable";

  const expected = [listSkillsByDomainSegmentTool.name, invokeSkillTool.name].join(", ");

  const tryExtractNames = (tools: unknown): string[] => {
    if (!Array.isArray(tools)) return [];
    return tools.map((t) => {
      if (t && typeof t === "object") {
        const x = t as Record<string, unknown>;
        if (typeof x.name === "string") return x.name;
        const fn = x.function;
        if (fn && typeof fn === "object" && typeof (fn as { name?: string }).name === "string") {
          return (fn as { name: string }).name;
        }
      }
      return "?";
    });
  };

  const kwargs = o.kwargs;
  if (kwargs && typeof kwargs === "object") {
    const tools = (kwargs as Record<string, unknown>).tools;
    const names = tryExtractNames(tools);
    if (names.length > 0) {
      return `成功：kwargs.tools 共 ${names.length} 个 [${names.join(", ")}]（期望: ${expected}）`;
    }
  }

  const lcKwargs = o.lc_kwargs;
  if (lcKwargs && typeof lcKwargs === "object") {
    const tools = (lcKwargs as Record<string, unknown>).tools;
    const names = tryExtractNames(tools);
    if (names.length > 0) {
      return `成功：lc_kwargs.tools 共 ${names.length} 个 [${names.join(", ")}]（期望: ${expected}）`;
    }
  }

  // ChatOpenAI 重写 withConfig：bindTools 返回仍是 ChatOpenAI，tools 在 defaultOptions（非 RunnableBinding.kwargs）
  const defOpt = (o as { defaultOptions?: Record<string, unknown> }).defaultOptions;
  if (defOpt && typeof defOpt === "object") {
    const tools = defOpt.tools;
    const names = tryExtractNames(tools);
    if (names.length > 0) {
      return `成功：defaultOptions.tools 共 ${names.length} 个 [${names.join(", ")}]（期望: ${expected}）`;
    }
  }

  const ctor = (model as { constructor?: { name?: string } }).constructor?.name ?? "?";
  return `部分成功：已 bindTools 且可 invoke，但未从 kwargs/defaultOptions 解析到 tools 列表（类型=${ctor}）；期望工具名: ${expected}`;
}

async function runIntentWithSkillTools(
  systemInstruction: string,
  userPrompt: string
): Promise<unknown> {
  const llm = getModel();
  const bindTools = (llm as { bindTools?: (tools: unknown[]) => { invoke: (x: unknown) => Promise<unknown> } })
    .bindTools;
  if (!bindTools) {
    log("[Intent]", "LLM tool 绑定", "跳过：当前模型无 bindTools，将直接 invoke（无工具阶段）");
    return llm.invoke([new SystemMessage(systemInstruction), new HumanMessage(userPrompt)]);
  }
  const modelWithTools = bindTools.call(llm, [
    listSkillsByDomainSegmentTool,
    invokeSkillTool
  ]);
  log("[Intent]", "LLM tool 绑定", describeLlmToolBinding(modelWithTools));

  const messages: Array<SystemMessage | HumanMessage | ToolMessage | { content: unknown; tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }> = [
    new SystemMessage(systemInstruction),
    new HumanMessage(userPrompt)
  ];
  for (let i = 0; i < 20; i++) {
    const aiMsg = (await modelWithTools.invoke(messages)) as {
      content: unknown;
      tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
    };
    const calls = aiMsg.tool_calls ?? [];
    if (calls.length > 0) {
      log(
        "[Intent]",
        `tool 轮次 ${i + 1}：模型请求调用`,
        calls.map((c) => c.name ?? "?").join(", ")
      );
    }

    messages.push(aiMsg);
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
            domainId: x.domainId,
            segmentId: x.segmentId,
            targetEntryId: x.targetEntryId,
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
