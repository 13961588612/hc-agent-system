import { z } from "zod/v3";
import {
  getSystemConfig,
  querySegmentZodEnumValues,
  type SystemConfig
} from "../config/systemConfig.js";

/**
 * 意图识别结构化结果（与 `docs/intent-recognition-execution-plan.md` 里程碑 1 对齐）。
 *
 * ## `dataQueryDomain` 与系统配置
 *
 * 问数业务分段 id 来自 `config/system.yaml` 的 `segments`（通常 `facets` 含 `business`），
 * 由 {@link listQuerySegmentIds} / {@link querySegmentZodEnumValues} 派生；**非写死在代码里**。
 * 启动时 `initCore` 会 `initSystemConfig` 并调用 {@link refreshIntentResultSchemaCache}，使
 * {@link getIntentResultSchema} 与当前配置一致。
 *
 * ## 语义分层（避免读代码时混淆）
 *
 * 1. **`intents[]`**：多意图列表，每条描述一个子意图及其槽位/问数域等；路由问数时由
 *    `getBestDataQueryIntent` 选取其中 `intent === "data_query"` 的一条（优先无 `missingSlots`）。
 * 2. **根级字段**（`dominantIntent`、`needsClarification`、`clarificationQuestion` 等）：
 *    全局路由与合成答案的「摘要」；`orchestratorGraph.routeAfterIntent` 先看根级
 *    `needsClarification`，再看 `dominantIntent`，再看问数条的 `missingSlots`。
 * 3. **`taskPlan`（可选）**：更细的任务拆解与缺参汇总，供 `composeAnswerNode` 生成澄清话术
 *    或执行预览；与根级、子意图字段**可并存**，运行时多处会分别读取。
 *
 * ## 已知「Schema 不校验、但业务上易矛盾」的约定缺口
 *
 * - **`dominantIntent` 与 `intents[]`**：Zod 不保证根级 `dominantIntent` 在 `intents` 中至少出现一次，
 *   也不保证与同标签子意图的 `confidence` 一致。建议模型输出时：`dominantIntent` 与某条
 *   `intents[].intent` 对齐，且该条代表本轮主叙事。
 * - **澄清标志多处**：根级 `needsClarification`、各 `intents[].needsClarification`、`taskPlan.nextAction`、
 *   `missingSlots` / `missingParamsSummary` 可能不同步。当前实现：`composeAnswerNode.wantsClarification`
 *   在根级 `needsClarification`、问数 `missingSlots`、`taskPlan` 多条路径上**或**关系；
 *   路由在 `needsClarification === false` 时仍会因 `missingSlots.length > 0` 走向澄清。建议：
 *   若需先澄清，根级 `needsClarification=true` 并填 `clarificationQuestion`，且与问数条状态一致。
 * - **`needsClarification === true` 与可执行问数**：可同时存在「全局要澄清」与某条 `data_query` 已齐参；
 *   路由仍以根级 `needsClarification` 优先进 `compose_answer`，不会进 `guide_agent`。
 * - **`confidence`**：根级与各子意图可各有一份，无互斥；不作为路由硬条件。
 * - **`replySuggestion`**：根级与各子意图均可有；合成逻辑按 `dominantIntent` 分支选用，避免根与子意图各说各话。
 *
 * 以上矛盾不会导致 Zod parse 失败，但会导致日志与产品表现难排查；注释用于约束调用方与 Prompt 预期。
 */
export function buildIntentResultSchema(config: SystemConfig) {
  const dataQueryDomainSchema = z.enum(querySegmentZodEnumValues(config));

  return z.object({
    /**
     * 多意图列表，至少 1 条。同轮可并存 `data_query` + `knowledge_qa` 等；
     * 问数执行路径只消费其中 `intent === "data_query"` 的条目（见 `getBestDataQueryIntent`）。
     */
    intents: z
      .array(
        z.object({
          /**
           * 子意图类型。与根级 `dominantIntent` 使用同一枚举；`data_query` 时可选填
           * `dataQueryDomain` / `targetIntent` / `resolvedSlots` / `missingSlots`。
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
           * 问数路由以 `missingSlots` 数组是否非空为硬条件之一。
           */
          needsClarification: z.boolean().optional(),
          /** 仅针对该子意图的追问句；全局追问优先用根级 `clarificationQuestion` */
          clarificationQuestion: z.string().optional(),
          /**
           * 已解析槽位（键名建议 snake_case）。`data_query` 可执行时规则上应提供，
           * 并写入 DataQuery 子图 `input.resolvedSlots`。
           */
          resolvedSlots: z.record(z.string(), z.unknown()).optional(),
          /**
           * 问数业务分段 id，与 `targetIntent` 成对使用；仅对 `data_query` 有意义。
           * 合法值由当前 `system.yaml` 的 segments（见 `listQuerySegmentIds`）决定。
           */
          dataQueryDomain: dataQueryDomainSchema.optional(),
          /**
           * 稳定能力/指南 id（与 `skills/intent` 规则、`targetIntent` 约定一致）。
           * 缺省时问数子图可能退化为关键词或 LLM 路径。
           */
          targetIntent: z.string().optional(),
          /**
           * 仍缺的槽位名列表。空或未定义表示问数条层面无缺失；
           * `getBestDataQueryIntent` 优先选 `missingSlots` 为空的 `data_query` 项。
           */
          missingSlots: z.array(z.string()).optional(),
          /**
           * 非问数或单条意图时的简短回复建议。与根级 `replySuggestion` 并存时，
           * 合成节点通常按 `dominantIntent` 走分支，不必两条同时展示。
           */
          replySuggestion: z.string().optional()
        })
      )
      .min(1),

    /**
     * 主导意图，决定 `routeAfterIntent` 在「未全局澄清、且问数无 missingSlots」时的分支：
     * `data_analysis` / `knowledge_qa` 直跳执行节点；`data_query` 且存在问数条则进 `guide_agent`。
     * 与 `intents[]` 无强制对应关系（见文件头「约定缺口」）。
     */
    dominantIntent: z.enum([
      "data_query",
      "data_analysis",
      "knowledge_qa",
      "chitchat",
      "unknown"
    ]),

    /**
     * 全局：是否应先向用户澄清再执行子图。为 **true** 时路由直接 `compose_answer`，
     * 不会进入 `guide_agent` / 问数执行，即使某条 `data_query` 已齐参。
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
     * - 与根级 `needsClarification` / 问数 `missingSlots` **并行存在**时，`wantsClarification`
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
              /** 计划使用的技能或指南入口；`kind` 与仓库内 skill/guide id 对应 */
              selectedEntry: z
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
              expectedOutput: z.enum(["table", "object", "summary"]).optional()
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
 * {@link refreshIntentResultSchemaCache}（由 `initCore` 负责）；若尚未注入有效配置，则按 `getSystemConfig()` 空壳构建（问数域枚举退化为 `other`）。
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
