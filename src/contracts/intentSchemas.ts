import { z } from "zod/v3";
import {
  getSystemConfig,
  businessSegmentZodEnumValues,
  type SystemConfig
} from "../config/systemConfig.js";

/**
 * 意图识别结构化结果
 *
 * ## 语义分层
 *
 * 1. **`intents[]`**：多意图列表，每条描述一个子意图及其槽位、可执行性与追问信息。
 * 2. **根级字段**（`needsClarification`、`clarificationQuestion` 等）：用于全局澄清与回复控制。
 * 3. **`planningTasks` / `taskPlan`（可选）**：任务拆解、能力选择、缺参汇总与执行预览。
 *
 * ## 一致性建议
 *
 * - `needsClarification` 与 `clarificationQuestion` 语义保持一致。
 * - `planningTasks[].missingSlots`、`taskPlan.missingParamsSummary` 与 `nextAction` 保持一致。
 * - `confidence`、`replySuggestion` 在根级与子意图可并存，建议避免语义冲突。
 *
 * 注：Schema 主要负责结构校验，跨字段语义一致性由调用方与编排逻辑共同保证。
 */
export function buildIntentResultSchema(config: SystemConfig) {
  const businessSegmentSchema = z.enum(businessSegmentZodEnumValues(config));
  const outputTypeSchema = z.enum(["table", "object", "summary"]);
  const followUpActionSchema = z.object({
    type: z.enum(["write_artifact", "reply_channel", "invoke_agent", "none"]),
    params: z.record(z.string(), z.unknown()).optional()
  });
  const skillStepSchema = z.object({
    /** 步骤唯一标识（同一 task 内稳定即可），用于日志与执行轨迹对齐 */
    stepId: z.string(),
    /** 技能域（如 retrieval / analysis / qa），用于粗粒度披露能力范围 */
    skillsDomainId: z.string(),
    /** 技能分段（如 member / ecommerce），用于缩小候选能力集合 */
    skillsSegmentId: z.string().optional(),
    /** 披露阶段得到的候选能力 id 列表（可多项） */
    disclosedSkillIds: z.array(z.string()).optional(),
    /**
     * 收敛后的最终能力入口（通常是单个）。
     * - `kind=skill`：可执行技能；
     * - `kind=guide`：指南能力（可再映射到可执行技能）。
     */
    selectedCapability: z
      .object({
        kind: z.enum(["skill", "guide"]),
        id: z.string()
      })
      .optional(),
    /** 该步骤要求的参数名列表（用于缺参判定） */
    requiredParams: z.array(z.string()).optional(),
    /** 当前已提供参数（可来自用户输入、上下文、槽位抽取） */
    providedParams: z.record(z.string(), z.unknown()).optional(),
    /** 仍缺失参数名列表；非空通常意味着该 step 不可执行 */
    missingParams: z.array(z.string()).optional(),
    /** 该步骤是否可直接执行（模型自评 + 参数判定结果） */
    executable: z.boolean().optional(),
    /** 预期输出形态，供后续节点做展示与衔接 */
    expectedOutput: outputTypeSchema.optional(),
    /** 该步骤完成后的后续动作（写产物、回包、调用子 agent 等） */
    followUpActions: z.array(followUpActionSchema).optional()
  });
  const planningTaskSchema = z.object({
    taskId: z.string(),
    systemModuleId: z.string(),
    goal: z.string(),
    resolvedSlots: z.record(z.string(), z.unknown()).optional(),
    missingSlots: z.array(z.string()).optional(),
    clarificationQuestion: z.string().optional(),
    executable: z.boolean().optional(),
    skillSteps: z.array(skillStepSchema).optional(),
    expectedOutput: outputTypeSchema.optional(),
    followUpActions: z.array(followUpActionSchema).optional()
  });

  return z.object({
    /**
     * 多意图列表，至少 1 条。同轮可并存多个子意图；
     * 具体执行路径由编排层按当前策略选择与消费。
     */
    intents: z
      .array(
        z.object({
          /**
           * 子意图类型。与根级 `dominantIntent` 使用同一枚举。
           * 通用上下文字段（如 `domainId` / `segmentId` / `targetEntryId` / `resolvedSlots`）
           * 可按需要在任意子意图上提供。
           */
          intent: z.enum([
            "data_query",
            "data_analysis",
            "knowledge_qa",
            "chitchat",
            "unknown"
          ]),
          /** 该子意图的自然语言目标，便于日志与 taskPlan 对齐 */
          goal: z.string().optional(),
          /** 模型对该子意图的置信度 0～1；与根级 `confidence` 独立 */
          confidence: z.number().optional(),
          /**
           * 该子意图是否已具备执行条件（模型自评）。**不与** `missingSlots` 联动校验：
           * 可能出现 `executable: true` 但仍带 `missingSlots`，调用方以槽位与路由逻辑为准。
           */
          executable: z.boolean().optional(),
          /**
           * 该子意图是否缺参（模型自评）。与根级 `needsClarification` 可能不一致；
           * 编排层可据 `missingSlots` 判定是否先澄清。
           */
          needsClarification: z.boolean().optional(),
          /** 仅针对该子意图的追问句；全局追问优先用根级 `clarificationQuestion` */
          clarificationQuestion: z.string().optional(),
          /**
           * 已解析槽位（键名建议 snake_case），可由后续任意执行节点复用。
           */
          resolvedSlots: z.record(z.string(), z.unknown()).optional(),
          /** 业务域 id（通用上下文字段），建议对齐 system domains 或执行模块 id。 */
          domainId: z.string().optional(),
          /**
           * 业务分段 id（通用上下文字段），可与 `targetEntryId` 搭配用于路由、能力收敛与后续编排。
           * 合法值由当前 `system.yaml` 的 business segments（见 `businessSegmentZodEnumValues`）决定。
           */
          segmentId: businessSegmentSchema.optional(),
          /**
           * 稳定能力/入口 id（可映射到 skill/guide 或其他执行入口）。
           * 缺省时由编排层按上下文做兜底选择。
           */
          targetEntryId: z.string().optional(),
          /** 仍缺的槽位名列表。空或未定义表示该子意图层面无缺失。 */
          missingSlots: z.array(z.string()).optional(),
          /**
           * 单条意图场景下的简短回复建议。与根级 `replySuggestion` 并存时，
           * 合成节点通常按 `dominantIntent` 走分支，不必两条同时展示。
           */
          replySuggestion: z.string().optional()
        })
      )
      .min(1),

    /**
     * 规划阶段状态：
     * - draft: 仅完成初步分解
     * - blocked: 存在缺参/需澄清
     * - ready: 规划通过，可进入执行
     */
    planPhase: z.enum(["draft", "blocked", "ready"]).optional(),
    /** 规划阶段的语言（尤其澄清话术） */
    replyLocale: z.enum(["zh", "en", "auto"]).optional(),
    /** 规划主产物：按 system-module 切分的任务列表 */
    planningTasks: z.array(planningTaskSchema).optional(),

    /**
     * 全局：是否应先向用户澄清再执行子图。为 **true** 时路由直接 `compose_answer`。
     */
    needsClarification: z.boolean(),

    /**
     * 全局追问句。Prompt 约定在 `needsClarification === true` 时应填写；
     * `composeAnswerNode` 仅在「有非空字符串」时将其视为有效澄清话术条件之一。
     */
    clarificationQuestion: z.string().optional(),

    /** 全局分类置信度 0～1；不参与 Zod 范围校验，也不单独驱动路由 */
    confidence: z.number().optional(),

    /**
     * 全局简短回复建议，常用于 `chitchat` / `unknown` 主导时由合成节点直接采用。
     * 与 `intents[].replySuggestion` 可能重复，宜二选一或保持一致语义。
     */
    replySuggestion: z.string().optional(),

    /**
     * 可选的任务级编排视图：子任务、缺参汇总、下一步动作等。
     * - 与根级 `needsClarification` / `missingSlots` **并行存在**时，`wantsClarification`
     *   仍可能因 `nextAction === "clarify"` 或 `missingParamsSummary` 非空而视为需澄清。
     * - 字段与 `intents[]` 不强制一致，适合作为 LLM 的「计划草稿」(debug / 用户可见预览)。
     */
    taskPlan: z
      .object({
        /**
         * domain + segment 候选及排序理由；不参与当前图硬路由，供分析与后续扩展。
         */
        domainSegmentRanking: z
          .array(
            z.object({
              domain: z.string(),
              segment: z.string(),
              score: z.number().optional(),
              reason: z.string().optional()
            })
          )
          .optional(),

        /**
         * 子任务列表。`executable` 与 `missingParams` 由模型填写，**不与** `intents[]` 自动对齐；
         * `composeAnswerNode` 在 `nextAction === "execute"` 时用其生成执行预览文案。
         */
        subTasks: z
          .array(
            z.object({
              taskId: z.string(),
              goal: z.string(),
              systemModuleId: z.string().optional(),
              /** 计划使用的技能或指南入口；`kind` 与仓库内 skill/guide id 对应 */
              selectedCapability: z
                .object({
                  kind: z.enum(["skill", "guide"]),
                  id: z.string()
                })
                .optional(),
              /**
               * 该子任务是否可执行。与 `intents[].executable` 含义平行，无交叉校验。
               */
              executable: z.boolean(),
              requiredParams: z.array(z.string()).optional(),
              providedParams: z.record(z.string(), z.unknown()).optional(),
              missingParams: z.array(z.string()).optional(),
              /** 自然语言或步骤标签式的执行计划，仅作说明 */
              plan: z.array(z.string()).optional(),
              /** 预期产出形态，不影响当前子图分支 */
              expectedOutput: outputTypeSchema.optional(),
              followUpActions: z.array(followUpActionSchema).optional()
            })
          )
          .optional(),

        /**
         * 缺参汇总（短句或参数名列表类字符串）。非空时 `wantsClarification` 可为 true，
         * 即使根级 `needsClarification === false`。
         */
        missingParamsSummary: z.array(z.string()).optional(),

        /**
         * 计划下一步：`clarify` 与 `execute` 可与根级澄清标志交叉——合成侧会综合判断。
         */
        nextAction: z.enum(["execute", "clarify"]).optional(),

        /** 对整个 taskPlan 的总结句，可作澄清兜底文案（见 `planClarificationMessage`） */
        finalSummary: z.string().optional()
      })
      .optional()
  });
}

let cachedIntentResultSchema: ReturnType<typeof buildIntentResultSchema> | undefined;

/**
 * 当前系统配置下的意图结果校验 Schema。须在 `initSystemConfig` 后调用
 * {@link refreshIntentResultSchemaCache}（由 `initCore` 负责）；若尚未注入有效配置，则按 `getSystemConfig()` 空壳构建（分段枚举退化为 `other`）。
 */
export function getIntentResultSchema() {
  if (!cachedIntentResultSchema) {
    cachedIntentResultSchema = buildIntentResultSchema(getSystemConfig());
  }
  return cachedIntentResultSchema;
}

/** `initSystemConfig` 之后调用，使枚举与 `system.yaml` 的 segments 一致 */
export function refreshIntentResultSchemaCache(): void {
  cachedIntentResultSchema = buildIntentResultSchema(getSystemConfig());
}

/** 单测或热替换配置后清空缓存，下次 `getIntentResultSchema` 再按当前 `getSystemConfig()` 构建 */
export function resetIntentResultSchemaCacheForTests(): void {
  cachedIntentResultSchema = undefined;
}

export type IntentResult = z.infer<ReturnType<typeof buildIntentResultSchema>>;
