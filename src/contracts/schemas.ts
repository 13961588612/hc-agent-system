import {
  type StateSchemaFields,
  ReducedValue,
  StateSchema
} from "@langchain/langgraph";
import { z } from "zod/v3";
import {
  getIntentResultSchema,
  type IntentResult
} from "./intentSchemas.js";

/** EnvConfig schema - accepts any object (openaiApiKey, dbUrl, etc.) */
export const EnvConfigSchema = z.object({}).passthrough();

/** LLM / 意图节点注入的参数化 SQL */
const DataQuerySqlItemSchema = z.object({
  sql: z.string(),
  params: z.array(z.unknown()).optional(),
  dbClientKey: z.string().optional(),
  label: z.string().optional(),
  purpose: z.string().optional()
});

const DataQueryPlanningTaskSchema = z.object({
  taskId: z.string().optional(),
  goal: z.string().optional(),
  systemModuleId: z.string().optional(),
  resolvedSlots: z.record(z.string(), z.unknown()).optional(),
  missingSlots: z.array(z.string()).optional(),
  executable: z.boolean().optional(),
  skillSteps: z
    .array(
      z.object({
        stepId: z.string().optional(),
        skillsDomainId: z.string().optional(),
        skillsSegmentId: z.string().optional(),
        disclosedCapabilityIds: z.array(z.string()).optional(),
        selectedCapability: z
          .object({
            kind: z.enum(["skill", "guide"]).optional(),
            id: z.string().optional(),
            ownerSkillId: z.string().optional()
          })
          .optional(),
        requiredParams: z.array(z.string()).optional(),
        providedParams: z.record(z.string(), z.unknown()).optional(),
        missingParams: z.array(z.string()).optional(),
        executable: z.boolean().optional(),
        executionSkillId: z.string().optional(),
        dbClientKey: z.string().optional(),
        expectedOutput: z.enum(["table", "object", "summary"]).optional()
      })
    )
    .optional()
});

/** DataQueryInput schema */
export const DataQueryInputSchema = z.object({
  userInput: z.string(),
  userId: z.string().optional(),
  env: EnvConfigSchema,
  sqlQuery: DataQuerySqlItemSchema.optional(),
  sqlQueries: z.array(DataQuerySqlItemSchema).optional(),
  sharedContext: z
    .object({
      priorTables: z
        .array(
          z.object({
            name: z.string().optional(),
            meta: z.record(z.unknown()).optional(),
            rows: z.array(z.record(z.unknown()))
          })
        )
        .optional(),
      priorRows: z.array(z.record(z.unknown())).optional()
    })
    .optional(),
  planningTask: DataQueryPlanningTaskSchema.optional(),
  planningTasks: z.array(DataQueryPlanningTaskSchema).optional(),
  /** 意图节点解析的槽位，子图优先据此路由与绑参 */
  resolvedSlots: z.record(z.string(), z.unknown()).optional(),
  /** 上一阶段透传的业务域 id（建议对齐 system domains / 模块 id） */
  domainId: z.string().optional(),
  /** 上一阶段透传的业务分段 id（建议对齐 system segments） */
  segmentId: z.string().optional(),
  /** 子图路由意图 id，与 `dataQueryDomain` 成对使用（来自 IntentResult.targetIntent） */
  targetIntent: z.string().optional(),
  /** 兼容旧字段：等价于 `segmentId` */
  dataQueryDomain: z.string().optional()
});

/** 单表数据结构，用于 tables 类型 */
const DataTableSchema = z.object({
  name: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  rows: z.array(z.record(z.unknown()))
});

/** DataQueryResult schema */
export const DataQueryResultSchema = z.object({
  /** 数据所属业务分段 id，与问数 `queryDomain` / 系统 segments 对齐 */
  domain: z.string(),
  /** 查询意图描述。例："query_recent_orders"、"get_user_profile" */
  intent: z.string(),
  /** 返回数据形态。table=单表，tables=多表，single=单条记录 */
  dataType: z.enum(["table", "tables", "single"]),
  /** 额外元信息，如列定义、说明等。例：{ columns: [...], title: "订单列表" } */
  meta: z.record(z.unknown()),
  /** 单表结果行，dataType 为 table/single 时使用。例：[{ id: 1, amount: 99 }, { id: 2, amount: 88 }] */
  rows: z.array(z.record(z.unknown())),
  /** 多表结果，dataType 为 tables 时使用。例：[{ name: "订单", rows: [...] }, { name: "积分", rows: [...] }] */
  tables: z.array(DataTableSchema).optional()
});


/** 单次查询：SQL 方式 */
export const SqlQueryStepSchema = z.object({
  kind: z.literal("sql"),
  /** 步骤标识，便于多步结果对齐 */
  id: z.string().optional(),
  sql: z.string(),
  params: z.array(z.unknown()).optional()
});

/** 单次查询：HTTP API 方式 */
export const ApiQueryStepSchema = z.object({
  kind: z.literal("api"),
  id: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  /** JSON body（POST/PUT 等） */
  body: z.unknown().optional(),
  /** URL 查询参数 */
  query: z.record(z.string()).optional()
});

/** 单次查询步骤（SQL 或 API 二选一） */
export const DataQueryStepSchema = z.discriminatedUnion("kind", [
  SqlQueryStepSchema,
  ApiQueryStepSchema
]);

/** 执行计划：支持多步查询，每步独立为 sql 或 api */
export const DataQueryExecutionPlanSchema = z.object({
  steps: z.array(DataQueryStepSchema)
});

/** DataQuery Graph state - 使用 StateSchema 定义 */
export const DataQueryStateSchema = new StateSchema({
  input: DataQueryInputSchema,
  queryDomain: z.string().optional(),
  queryIntent: z.string().optional(),
  executionPlan: DataQueryExecutionPlanSchema.optional(),
  result: DataQueryResultSchema.optional()
} as unknown as StateSchemaFields);

/** Orchestrator Graph state - 使用 StateSchema 定义 */

/** 主图多轮对话中的一条（user / assistant） */
export const ConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string()
});

const MAX_CONVERSATION_TURNS = 10;

/** OrchestratorInput schema */
export const OrchestratorInputSchema = z.object({
  userInput: z.string(),
  userId: z.string().optional(),
  channel: z.string().optional(),
  env: EnvConfigSchema,
  sqlQuery: DataQuerySqlItemSchema.optional(),
  sqlQueries: z.array(DataQuerySqlItemSchema).optional()
});

/** resultsIndex 的 key：子任务或步骤 id（字符串标识） */
export const ResultsIndexKeySchema = z.string();

/** 编排器里「某次子任务/结果」在索引中的一条记录 */
export const ResultsIndexEntrySchema = z.object({
  /** 子任务执行状态：成功 / 失败 / 部分成功 */
  status: z.enum(["success", "failed", "partial"]),
  /** 该条结果的简短摘要，便于展示或日志 */
  summary: z.string(),
  /** 可选：结构化结果预览（如 DataQueryResult），供渠道格式化展示 */
  data: z.unknown().optional(),
  /** 关联产物（文件、导出等），可选 */
  artifacts: z
    .array(
      z.object({
        /** 产物唯一标识 */
        id: z.string(),
        /** 产物在存储中的路径（如本地路径、对象存储 key） */
        path: z.string(),
        /** 产物类型，如 csv、json、chart */
        type: z.string()
      })
    )
    .optional()
});

export const OrchestratorStateSchema = new StateSchema({
  /** 编排器入口：用户输入、用户 id、渠道、环境配置等 */
  input: OrchestratorInputSchema,
  /** 意图识别后的高层域：数据查询类 vs 其他 */
  highLevelDomain: z.enum(["data_query", "other"]).optional(),
  /** 结构化意图（LLM + 兜底）；校验随 `system.yaml` segments，故用 lazy 在运行时解析 */
  intentResult: z.lazy(() => getIntentResultSchema()).optional(),
  /** 会话轮次（append reducer，最多保留最近若干条） */
  // LangGraph `SerializableSchema` 与 `zod/v3` 的 TS 声明不完全一致，运行时仍按 Zod 校验
  conversationTurns:
    // @ts-expect-error ReducedValue 与 zod/v3 的 Standard Schema 类型在依赖侧未完全对齐
    new ReducedValue(z.array(ConversationTurnSchema), {
      inputSchema: z.union([ConversationTurnSchema, z.array(ConversationTurnSchema)]),
      reducer: (
        current: z.infer<typeof ConversationTurnSchema>[],
        next:
          | z.infer<typeof ConversationTurnSchema>
          | z.infer<typeof ConversationTurnSchema>[]
      ) => {
        const prev = current ?? [];
        const batch = Array.isArray(next) ? next : [next];
        const merged = [...prev, ...batch];
        return merged.slice(-MAX_CONVERSATION_TURNS);
      }
    }),
  /** 各子任务/步骤结果的索引：key 见 ResultsIndexKeySchema，value 为状态与摘要 */
  resultsIndex: z.record(ResultsIndexKeySchema, ResultsIndexEntrySchema).optional(),
  /** 最近一次数据集引用，便于后续节点复用或追问 */
  lastDataSetRef: z
    .object({
      /** 数据集或产物的标识 */
      id: z.string(),
      /** 数据集所在路径（与 artifacts.path 语义一致时可指向同一资源） */
      path: z.string()
    })
    .optional(),
  /**
   * 当前追问 streak 内已发出的澄清次数（assistant 追问条数）。
   * 非澄清类 finalAnswer 时归零；达上限则不再追问。
   */
  clarificationRound: z.number().optional(),
  /**
   * 最近一次发出澄清的时间戳（ms）。0 表示当前无有效「追问窗口」。
   * 用于空闲超时后重置 `clarificationRound`。
   */
  lastClarificationAtMs: z.number().optional(),
  /** 里程碑 6.2：Guide 编排阶段 */
  guidePhase: z
    .enum(["idle", "ready", "awaiting_slot", "skipped"])
    .optional(),
  selectedGuideId: z.string().optional(),
  selectedCapabilityId: z.string().optional(),
  guideResolvedParams: z.record(z.string(), z.unknown()).optional(),
  guideMissingParams: z.array(z.string()).optional(),
  /** 编排器最终对用户/调用方的回答（结构由上层决定） */
  finalAnswer: z.unknown()
} as unknown as StateSchemaFields);

/**
 * 与 `OrchestratorState` 相同原因：`StateSchema.State` 可能推断为 `never`，节点内显式声明形状。
 */
export type DataQueryState = {
  input: z.infer<typeof DataQueryInputSchema>;
  queryDomain?: string;
  queryIntent?: string;
  executionPlan?: z.infer<typeof DataQueryExecutionPlanSchema>;
  result?: z.infer<typeof DataQueryResultSchema>;
};

/**
 * LangGraph `StateSchema.State` 在部分版本下会推断为含 `never` 字段，节点内无法访问 `input`。
 * 此处用与 `OrchestratorStateSchema` 一致的 Zod 结构显式声明，供节点与 Agent 类型检查。
 */
export type OrchestratorState = {
  input: z.infer<typeof OrchestratorInputSchema>;
  highLevelDomain?: "data_query" | "other";
  intentResult?: IntentResult;
  conversationTurns?: z.infer<typeof ConversationTurnSchema>[];
  resultsIndex?: Record<string, z.infer<typeof ResultsIndexEntrySchema>>;
  lastDataSetRef?: {
    id: string;
    path: string;
  };
  /** 已发出澄清条数（追问 streak），达上限则降级为 fallback */
  clarificationRound?: number;
  /** 上次追问时间；0 表示无 */
  lastClarificationAtMs?: number;
  guidePhase?: "idle" | "ready" | "awaiting_slot" | "skipped";
  selectedGuideId?: string;
  selectedCapabilityId?: string;
  guideResolvedParams?: Record<string, unknown>;
  guideMissingParams?: string[];
  finalAnswer?: unknown;
};
