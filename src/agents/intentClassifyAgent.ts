import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { OrchestratorState } from "../contracts/schemas.js";
import { getIntentResultSchema } from "../contracts/intentSchemas.js";
import {
  getSystemConfig,
  listBusinessSegments,
  listSkillsDomains,
  listSkillsSegments,
  listSystemModuleDomains
} from "../config/systemConfig.js";
import { getIntentLlmTimeoutMs } from "../config/intentPolicy.js";
import { log } from "../lib/log/log.js";
import { getModel } from "../model/index.js";
import { getGuide } from "../lib/guides/guideRegistry.js";
import { allTools, TOOL_HANDLERS } from "../lib/tools/tools.js";

/** 与 skills 目录中 Guide id 一致；规则已注入系统提示，工具层禁止再 invoke 以免死循环 */
const INTENT_COMMON_GUIDE_ID = "intent-common";

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
  const systemContext = formatSystemContextForIntentPrompt();
  const intentGuide = getGuide(INTENT_COMMON_GUIDE_ID);
  const guideBlock = intentGuide
    ? `【意图与规划规则（已内嵌自 Guide「${INTENT_COMMON_GUIDE_ID}」，勿再 invoke_skill 拉取同 id）】\n${intentGuide.body}\n`
    : `【意图与规划】未在注册表中找到 Guide「${INTENT_COMMON_GUIDE_ID}」，请仍严格按 IntentResultSchema 输出 JSON。\n`;

  return `你是客服场景的多意图识别与任务拆解器。
${guideBlock}
工具仅用于辅助发现**业务域**能力：可用 \`list_skills_by_domain_segment\` 列候选，再用 \`invoke_skill\` 查看**非 intent-common** 的 skill/guide 详情。**禁止**对 skillId=\`${INTENT_COMMON_GUIDE_ID}\` 调用 \`invoke_skill\`（规则已在上方全文给出）。
只做意图识别与任务拆解；输出**一条**符合 IntentResultSchema 的 JSON 后结束（最终一轮应无 tool_calls）。不要执行真实 SQL、不要在本阶段跑业务查询。
${systemContext}

`;
}

function parseIntentPayloadFromModelContent(content: unknown): unknown {
  if (typeof content === "string") {
    const s = content.trim();
    if (!s) return content;
    try {
      return JSON.parse(s);
    } catch {
      // 兼容前后包裹说明文字的场景，尝试截取首个 JSON 对象
      const first = s.indexOf("{");
      const last = s.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          return JSON.parse(s.slice(first, last + 1));
        } catch {
          return content;
        }
      }
      return content;
    }
  }
  return content;
}

function normalizeIntentPayloadForSchema(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as Record<string, unknown>;

  // 兼容 replySuggestion 返回数组的情况（schema 当前要求 string）
  const normalizeSuggestion = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((x) => x.length > 0);
      if (parts.length > 0) return parts.join(" / ");
    }
    return undefined;
  };

  const rootSuggestion = normalizeSuggestion(obj.replySuggestion);
  if (rootSuggestion) obj.replySuggestion = rootSuggestion;

  if (Array.isArray(obj.intents)) {
    obj.intents = obj.intents.map((x) => {
      if (!x || typeof x !== "object") return x;
      const item = { ...(x as Record<string, unknown>) };
      const sug = normalizeSuggestion(item.replySuggestion);
      if (sug) item.replySuggestion = sug;
      return item;
    });
  }

  // 兼容旧字段 disclosedSkillIds -> disclosedCapabilityIds
  if (Array.isArray(obj.planningTasks)) {
    obj.planningTasks = obj.planningTasks.map((t) => {
      if (!t || typeof t !== "object") return t;
      const task = { ...(t as Record<string, unknown>) };
      if (Array.isArray(task.skillSteps)) {
        task.skillSteps = task.skillSteps.map((s) => {
          if (!s || typeof s !== "object") return s;
          const step = { ...(s as Record<string, unknown>) };
          if (
            step.disclosedCapabilityIds === undefined &&
            Array.isArray(step.disclosedSkillIds)
          ) {
            step.disclosedCapabilityIds = step.disclosedSkillIds;
          }
          if (
            step.selectedCapability &&
            typeof step.selectedCapability === "object"
          ) {
            const sc = {
              ...(step.selectedCapability as Record<string, unknown>)
            };
            if (
              sc.ownerSkillId === undefined &&
              typeof sc.skillId === "string" &&
              sc.skillId.trim()
            ) {
              sc.ownerSkillId = sc.skillId.trim();
            }
            delete sc.skillId;
            step.selectedCapability = sc;
          }
          delete step.disclosedSkillIds;
          return step;
        });
      }
      return task;
    });
  }

  return obj;
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
    allTools.list_skills_by_domain_segment,
    allTools.invoke_skill
  ]);

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
        if (name === "invoke_skill") {
          const skillId = String(args["skillId"] ?? "").trim();
          if (skillId === INTENT_COMMON_GUIDE_ID) {
            toolResult = JSON.stringify({
              ok: true,
              hint: `「${INTENT_COMMON_GUIDE_ID}」规则已在系统提示中完整给出，请勿重复 invoke。请改用工具查询业务域技能，并在最后一轮直接输出 JSON（无 tool_calls）。`
            });
          } else if (TOOL_HANDLERS[name]) {
            toolResult = await TOOL_HANDLERS[name](args);
          } else {
            toolResult = JSON.stringify({
              ok: false,
              error: `unknown tool: ${name}`
            });
          }
        } else if (TOOL_HANDLERS[name]) {
          toolResult = await TOOL_HANDLERS[name](args);
        } else {
          toolResult = JSON.stringify({
            ok: false,
            error: `unknown tool: ${name}`
          });
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

/**
 * LLM 结构化意图 + 关键词兜底；与 `highLevelDomain` 在同一出口对齐。
 */
export async function runIntentClassifyAgent(
  state: OrchestratorState
): Promise<Pick<OrchestratorState, "intentResult" | "highLevelDomain">> {
  const userInput = state.input.userInput;
  let lastRawMsg: { content?: unknown; tool_calls?: unknown } | undefined;
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
    const instruction = buildIntentJsonInstructionBase();
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
    lastRawMsg = rawMsg;
    log(
      "[Intent]",
      "LLM 原始返回（content + tool_calls）",
        JSON.stringify(rawMsg, null, 2)
    );
    const normalized = normalizeIntentPayloadForSchema(
      parseIntentPayloadFromModelContent(rawMsg.content)
    );
    const intent = getIntentResultSchema().parse(normalized);
    return { intentResult: intent };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(
      "[Intent]",
      "classify 失败（将返回 blocked 兜底）",
      `${msg}${lastRawMsg ? ` | raw=${JSON.stringify(lastRawMsg).slice(0, 1200)}` : ""}`,
      tAll
    );
    return {
      intentResult: {
        intents: [
          {
            intent: "unknown",
            goal: "意图识别失败，等待用户补充",
            executable: false,
            needsClarification: true,
            missingSlots: ["intent_parse_failed"]
          }
        ],
        planPhase: "blocked",
        planningTasks: [
          {
            taskId: "task-intent-fallback",
            systemModuleId: "unknown",
            goal: "恢复意图识别并收集必要信息",
            missingSlots: ["intent_parse_failed"],
            executable: false
          }
        ],
        needsClarification: true,
        clarificationQuestion:
          "我这边暂时无法稳定解析你的请求。请补充：你要查询的业务对象、时间范围、以及可用标识（如会员号/手机号/订单号）。",
        replySuggestion: "请提供更具体的查询条件后我再继续。"
      }
    };
  }
}
