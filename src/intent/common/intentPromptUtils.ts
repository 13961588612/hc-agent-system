import {
  getSystemConfig,
  listBusinessDomains,
  listDomains,
  listIntentions,
  type DomainEntry,
  type IntentionEntry
} from "../../config/systemConfig.js";
import { getDomainIdDescription, getIntentionIdDescription } from "../../contracts/SystemSchema.js";
import { getIntentSeparateOutputParser } from "../../../separate/intentSeparateOutputParser.js";

/**
 * 与业务 Guide 文档 id 对齐，仅用于 invoke_skill 拦截（避免重复拉取）；
 * 意图阶段系统规则全部由本文件内联字符串提供，不读取任何 .md 正文。
 */
export const INTENT_COMMON_GUIDE_ID = "intent-planning-decompose-and-orchestrate";

/** 第一阶段意图识别：规则内联在代码中，与 {@link getIntentSeparateResultSchema} 一致 */
function buildIntentSeparateRulesInline(): string {
  return `【第一阶段：轻量意图识别（仅下列 JSON 字段）】
- 根据系统设定的 意图类型 与 域类型 配置拆分子意图。
- 输出唯一一个 JSON 对象，不要附加说明文字。
- intents[]：至少 1 条；
- intent：意图类型,${getIntentionIdDescription()}
- domainId：域类型,${getDomainIdDescription()}
- 不要输出其他字段。
- 不要拆分到各个步骤，如果多个步骤组合完成一个任务，应该整合在一个任务里。
- 一个子意图不应跨多个意图类型与域类型，如果一个子意图跨多个意图类型与域类型，应该拆分为多个子意图。
`;
}

/** 从 system.yaml 注入到意图识别提示词中的系统摘要（只读配置，不写死业务） */
let intentPromptSystemContextCache: string | undefined;

/** 热替换 system 配置或单测时可清空，使下次重新拉取 */
export function resetIntentPromptSystemContextCache(): void {
  intentPromptSystemContextCache = undefined;
}


async function getSystemContextForIntentPrompt(): Promise<string> {
  return "";
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
