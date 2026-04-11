import {
  getSystemConfig,
  listBusinessDomains,
  listDomains,
  listModules,
  type DomainEntry,
  type ModuleEntry
} from "../../config/systemConfig.js";
import { getIntentSeparateOutputParser } from "../separate/intentSeparateOutputParser.js";

/**
 * 与业务 Guide 文档 id 对齐，仅用于 invoke_skill 拦截（避免重复拉取）；
 * 意图阶段系统规则全部由本文件内联字符串提供，不读取任何 .md 正文。
 */
export const INTENT_COMMON_GUIDE_ID = "intent-planning-decompose-and-orchestrate";

/** 第一阶段意图识别：规则内联在代码中，与 {@link getIntentSeparateResultSchema} 一致 */
function buildIntentSeparateRulesInline(): string {
  return `【第一阶段：轻量意图识别（仅下列 JSON 字段）】
- 根据系统 module domain 配置拆分任务。
- 输出唯一一个 JSON 对象，不要附加说明文字。
- intents[]：至少 1 条；每条**必须**含 semanticTaskBrief、intent；intent 取值须为：data_query | data_analysis | knowledge_qa | chitchat | unknown（与代码校验一致）。
- semanticTaskBrief：不含手机号/会员号/订单号等具体值的「语义完备的任务描述」，说明要有哪些条件、做哪类事、涉及哪类业务对象或数据,比如根据会员卡号查询一段时间内的会员销售和会员的资料；具体标识一律放 resolvedSlots，勿写入本字段。
- moduleId、domainId：与该项任务语义对应的module/domain（可选，但与配置列表对齐）。
- 每条可选：goal、confidence、resolvedSlots、replySuggestion。
- 根级可选：replyLocale（与 schema 枚举一致）、confidence、replySuggestion。
- 不要输出其他字段。
- 不要拆分到各个步骤，如果多个步骤组合完成一个任务，应该整合在一个任务里。
- 一个任务不应跨多个 module/domain，如果一个任务跨多个 module/domain，应该拆分为多个任务。
- 查询技能列表时，同一moduleId/domainId只查询一次，不要重复查询。
`;
}

/** 从 system.yaml 注入到意图识别提示词中的系统摘要（只读配置，不写死业务） */
let intentPromptSystemContextCache: string | undefined;

/** 热替换 system 配置或单测时可清空，使下次重新拉取 */
export function resetIntentPromptSystemContextCache(): void {
  intentPromptSystemContextCache = undefined;
}

function formatModuleLine(m: ModuleEntry): string {
  const parts: string[] = [];
  if (m.title) parts.push(`标题：${m.title}`);
  if (m.description) parts.push(`说明：${m.description}`);
  const tail = parts.length ? ` | ${parts.join(" | ")}` : "";
  return `  - systemModuleId="${m.id}"${tail}`;
}

function formatBusinessSegmentLine(d: DomainEntry): string {
  const parts: string[] = [];
  if (d.title) parts.push(`标题：${d.title}`);
  if (d.description) parts.push(d.description);
  const tail = parts.length ? ` | ${parts.join(" | ")}` : "";
  return `  - segmentId="${d.id}"${tail}`;
}

function formatOtherDomainLine(d: DomainEntry): string {
  const facetStr =
    d.facets && d.facets.length > 0 ? ` facets=[${d.facets.join(", ")}]` : "";
  const parts: string[] = [];
  if (d.title) parts.push(d.title);
  if (d.description) parts.push(d.description);
  const meta = parts.length ? ` | ${parts.join(" | ")}` : "";
  return `  - domainId="${d.id}"${facetStr}${meta}`;
}

/**
 * 将当前 `system.yaml` 摘要注入意图提示词：
 * - module → systemModuleId
 * - domains（facets 含 business）→ segmentId
 * - 其余 domains → domainId / facets 参考
 * - skills 相关：显式列出 facets 含 skills 的域，否则给工具参数约定说明
 */
async function formatSystemContextForIntentPrompt(): Promise<string> {
  const cfg = await getSystemConfig();
  const ver =
    typeof cfg.version === "number" && Number.isFinite(cfg.version)
      ? String(cfg.version)
      : "—";

  const modules = await listModules();
  const moduleBlock =
    modules.length > 0
      ? modules.map(formatModuleLine).join("\n")
      : `  - （未配置 module：systemModuleId 须与 intents 语义一致，可用 data_query / data_analysis / knowledge_qa 等稳定 id）`;

  const business = await listBusinessDomains();
  const businessBlock =
    business.length > 0
      ? business.map(formatBusinessSegmentLine).join("\n")
      : `  - （无 facets 含 business 的域：segmentId 可用 other 或与 list_skills 披露一致）`;

  const allDomains = await listDomains();
  const businessIds = new Set(business.map((b) => b.id));
  const otherDomains = allDomains.filter((d) => !businessIds.has(d.id));
  const otherBlock =
    otherDomains.length > 0
      ? `\n- 其它 domains（含 facets，可作 domainId 或非业务分段参考）：\n${otherDomains.map(formatOtherDomainLine).join("\n")}`
      : "";

  const skillsFacetDomains = allDomains.filter((d) =>
    (d.facets ?? []).includes("skills")
  );
  const skillsBlock =
    skillsFacetDomains.length > 0
      ? `\n- 技能披露 skillsDomainId（facets 含 skills）：\n${skillsFacetDomains
          .map(
            (d) =>
              `  - skillsDomainId="${d.id}"${d.title ? ` | ${d.title}` : ""}`
          )
          .join("\n")}\n- skillsSegmentId 宜与上列 segmentId / domainId 对齐。`
      : `\n- 技能披露约定：list_skills_by_domain_segment 的 domain 常为 data_query；skillsSegmentId 与业务 segmentId 一致（如 member、ecommerce）。`;

  return `【当前系统信息】（来自 config/system.yaml）
- 配置 version：${ver}
- 系统模块（systemModuleId）
${moduleBlock}
- 业务分段（segmentId，domains 且 facets 含 business）
${businessBlock}${otherBlock}${skillsBlock}`;
}

async function getSystemContextForIntentPrompt(): Promise<string> {
  if (intentPromptSystemContextCache === undefined) {
    intentPromptSystemContextCache = await formatSystemContextForIntentPrompt();
  }
  return intentPromptSystemContextCache;
}

export async function buildIntentSeparateInstruction(): Promise<string> {
  const systemContext = await getSystemContextForIntentPrompt();
  const intentSeparateRules = buildIntentSeparateRulesInline();
  const formatInstructions = getIntentSeparateOutputParser().getFormatInstructions();

  return `你是客服场景的多意图识别与任务拆解器。
${intentSeparateRules}
不要执行真实 SQL、不要在本阶段跑业务查询。
${systemContext}

【结构化输出】须严格满足下列格式说明（与程序侧 StructuredOutputParser 一致）：
${formatInstructions}
`;
}

export function buildIntentTaskStepsRulesInline(): string {
  return `【第二阶段：task/step 规划回写（仅输出 JSON）】
- 你将收到已有 非空的intents，以及resolvedSlots。
- 只针对 data_query 意图，重写相关的 planningTasks/skillSteps 与澄清字段，保留其它意图不变。
- 输出必须是单个 JSON 对象，不要 markdown，不要解释。
- 对每个 data_query intent 生成 task 与至少一个 step。
- step 必须包含：selectedSkillId、selectedSkillKind、requiredParams、providedParams、missingParams、executable。
- 使用工具 list_skills_by_domain_segment，查看skillId对应的skill信息，并选择一个最合适的skillId。
- 当 resolvedSlots 缺失时，按用户输入与上下文尽量补齐 providedParams，并将无法确定的字段写入 missingParams。
- 若存在缺参：planPhase=blocked；否则 planPhase=ready。
- expectedOutput 使用约定：resultType=...;resultPath=...
- 不要执行真实 SQL、不要访问外部数据。`;
}

export async function buildIntentTaskStepsInstruction(): Promise<string> {
  const systemContext = await getSystemContextForIntentPrompt();
  const intentTaskStepsRules = buildIntentTaskStepsRulesInline();

  return `你是客服场景的多意图识别与任务拆解器。
${intentTaskStepsRules}
工具仅用于辅助发现业务域 skill/guide：可用 \`list_skills_by_domain_segment\` 列候选，再用 \`invoke_skill\` 查看**非** skillId=\`${INTENT_COMMON_GUIDE_ID}\` 的详情。**禁止**对 \`${INTENT_COMMON_GUIDE_ID}\` 调用 \`invoke_skill\`（意图规则已全部在本系统提示中给出，重复拉取无意义）。
**性能**：工具轮次尽量少——建议「list 1 次 + invoke 0～2 次」即输出最终 JSON；不要反复 list，也不要对每个候选都 invoke。
最终一轮应无 tool_calls。不要执行真实 SQL、不要在本阶段跑业务查询。
${systemContext}

`;
}
