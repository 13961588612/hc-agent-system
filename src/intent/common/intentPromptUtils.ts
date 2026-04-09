import {
  getSystemConfig,
  listBusinessSegments,
  listSkillsDomains,
  listSkillsSegments,
  listSystemModuleDomains
} from "../../config/systemConfig.js";

/**
 * 与业务 Guide 文档 id 对齐，仅用于 invoke_skill 拦截（避免重复拉取）；
 * 意图阶段系统规则全部由本文件内联字符串提供，不读取任何 .md 正文。
 */
export const INTENT_COMMON_GUIDE_ID = "intent-planning-decompose-and-orchestrate";

/** 第一阶段意图识别：规则内联在代码中，与 Stage1IntentPayloadSchema 一致 */
function buildIntentSeparateRulesInline(): string {
  return `【第一阶段：轻量意图识别（仅下列 JSON 字段）】
- 根据系统 domain segment配置，拆分任务。
- 输出唯一一个 JSON 对象，不要附加说明文字。
- intents[]：至少 1 条；每条**必须**含 semanticTaskBrief,intent ;itent可取值 'data_query' | 'data_analysis' | 'knowledge_qa' | 'chitchat' | 'unknown'。
- semanticTaskBrief：不含手机号/会员号/订单号等具体值的「语义完备的任务描述」，说明要有哪些条件、做哪类事、涉及哪类业务对象或数据（例如「按会员卡号查询近期积分流水明细,按手机号查询会员积分账户信息」）；具体标识一律放 resolvedSlots，勿写入本字段。
- domainId、segmentId：与 semanticTaskBrief 对应的 domainId、segmentId。
- 可选：confidence、resolvedSlots、confidence、replySuggestion、goal。
- 根级可选：confidence、replySuggestion。
- 不要输出其他字段。
- 不要拆分到各个步骤，如果多个步骤组合完成一个任务，应该整合在一个任务里。
- 一个任务不应跨多个 domain/segment，如果一个任务跨多个 domain/segment，应该拆分为多个任务。
- 查询技能列表时，同一domainId/segmentId只查询一次，不要重复查询。
`;
}

/** 从 system.yaml 注入到意图识别提示词中的系统摘要（只读配置，不写死业务） */
let systemContext: string | undefined;

function getSystemContextForIntentPrompt(): string {
  if (!systemContext) 
    systemContext = formatSystemContextForIntentPrompt();
  return systemContext;
}


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

  return `【当前系统信息】（来自 config/system.yaml，用于选对 domain/segment）
- 配置 version：${ver}
- 系统域（domains）：
${moduleBlock}
- 业务域（segments）：
${businessBlock}`;
}

export function buildIntentSeparateInstruction(): string {
  const systemContext = getSystemContextForIntentPrompt();
  const intentSeparateRules = buildIntentSeparateRulesInline();

  return `你是客服场景的多意图识别与任务拆解器。
${intentSeparateRules}
不要执行真实 SQL、不要在本阶段跑业务查询。
${systemContext}

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

export function buildIntentTaskStepsInstruction(): string {
  const systemContext = formatSystemContextForIntentPrompt();
  const intentTaskStepsRules = buildIntentTaskStepsRulesInline();

  return `你是客服场景的多意图识别与任务拆解器。
${intentTaskStepsRules}
工具仅用于辅助发现业务域 skill/guide：可用 \`list_skills_by_domain_segment\` 列候选，再用 \`invoke_skill\` 查看**非** skillId=\`${INTENT_COMMON_GUIDE_ID}\` 的详情。**禁止**对 \`${INTENT_COMMON_GUIDE_ID}\` 调用 \`invoke_skill\`（意图规则已全部在本系统提示中给出，重复拉取无意义）。
**性能**：工具轮次尽量少——建议「list 1 次 + invoke 0～2 次」即输出最终 JSON；不要反复 list，也不要对每个候选都 invoke。
最终一轮应无 tool_calls。不要执行真实 SQL、不要在本阶段跑业务查询。
${systemContext}

`;
}
