import type { EnvConfig } from "../config/envConfig.js";

/** 主→子：统一任务下发协议 */
export interface SubTaskEnvelope<TInputs = unknown> {
  /** 子任务唯一标识，与结果、artifact 对齐 */
  taskId: string;
  /** LangGraph / 会话线程 id，用于 checkpoint 与隔离 */
  threadId: string;
  /** 由哪个子 Agent 执行，如数据查询、分析、表单 */
  agentType: "data_query" | "data_analysis" | "smart_form" | string;
  /** 自然语言描述的任务目标，供子 Agent 理解要做什么 */
  goal: string;
  /** 结构化入参，类型由具体 agent 约定（如 DataQueryInput） */
  inputs: TInputs;
  /** 可选约束：超时、行数上限、脱敏规则等 */
  constraints?: Record<string, unknown>;
  /** 编排器注入的跨任务上下文（非业务主输入） */
  context?: {
    /** 渠道：cli、web、企微等 */
    channel?: string;
    /** 用户画像或长期摘要，可选 */
    userSummary?: string;
    /** 当前对话摘要，便于多轮理解 */
    conversationSummary?: string;
    /** 上游产物或数据集引用，如 lastDataSetRef、历史 artifact */
    refs?: Array<{
      /** 引用类型，如 dataset、artifact、table */
      type: string;
      /** 与 OrchestratorState / 存储侧一致的 id */
      id: string;
      /** 可解析路径（文件、对象存储 key 等） */
      path?: string;
    }>;
  };
  /** 期望输出契约名与版本，便于校验与演进 */
  expectedOutputSchema: {
    /** 契约名称，如 DataQueryResult */
    name: string;
    /** 契约版本号 */
    version: string;
  };
}

/** 子→主：统一结果回传协议 */
export interface SubTaskResult<TData = unknown> {
  /** 对应 SubTaskEnvelope.taskId */
  taskId: string;
  /** 子任务整体状态 */
  status: "success" | "failed" | "partial";
  /** 给人看的简短结论，可展示或写入日志 */
  summary: string;
  /** 结构化业务结果，类型与 expectedOutputSchema 对应 */
  data?: TData;
  /** 落盘或外部存储的产物列表（大数据走 path，不塞进 data） */
  artifacts?: Array<{
    /** 产物 id，可与 lastDataSetRef / refs 对齐 */
    id: string;
    /** 产物类型，如 json、csv、dataset */
    type: string;
    /** 存储路径或可读路径 */
    path: string;
    /** 可选说明 */
    description?: string;
  }>;
  /** 调试与可观测性信息 */
  debug?: {
    /** 使用到的技能名称 */
    usedSkills?: string[];
    /** 使用到的工具名称 */
    usedTools?: string[];
    /** 各阶段耗时（毫秒） */
    timingsMs?: Record<string, number>;
    /** 非致命告警 */
    warnings?: string[];
  };
}

/**
 * 单条待执行 SQL：由 **LLM 按 SkillGuide 生成** 或意图节点填充，须 **参数绑定**。
 * DataQuery 子图只负责执行，不解析 Guide、不内置业务模板。
 */
export interface DataQuerySqlItem {
  sql: string;
  params?: unknown[];
  /** `DbClientManager` 连接键；会员库一般为 `member`，未填则用 `default` */
  dbClientKey?: string;
  /** 结果表中 `name`、错误映射用；建议填能力 id 或简短说明 */
  label?: string;
  /** 传入 `sql-query` 的 purpose 日志 */
  purpose?: string;
}

export interface OrchestratorInput {
  userInput: string;
  userId?: string;
  channel?: string;
  env: EnvConfig;
  /**
   * 意图 / Agent 工具在披露 SkillGuide 后生成 SQL，注入此处执行。
   * 与 `sqlQueries` 同时存在时，**非空 `sqlQueries` 优先**。
   */
  sqlQuery?: DataQuerySqlItem;
  /** 同一子任务内顺序执行多条，合并为 `DataQueryResult.dataType === "tables"` */
  sqlQueries?: DataQuerySqlItem[];
}

/** resultsIndex 的 key：子任务或步骤 id（与 `ResultsIndexKeySchema` 一致） */
export type ResultsIndexKey = string;

export type QueryDomain = "member" | "ecommerce" | "other";

export interface DataQueryInput {
  userInput: string;
  userId?: string;
  env: EnvConfig;
  sqlQuery?: DataQuerySqlItem;
  sqlQueries?: DataQuerySqlItem[];
}

/** 执行计划中单步：SQL */
export interface SqlQueryStep {
  kind: "sql";
  id?: string;
  sql: string;
  params?: unknown[];
}

/** 执行计划中单步：HTTP API */
export interface ApiQueryStep {
  kind: "api";
  id?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export type DataQueryStep = SqlQueryStep | ApiQueryStep;

/** 多步执行计划 */
export interface DataQueryExecutionPlan {
  steps: DataQueryStep[];
}

/** 单表数据，用于多表返回 */
export interface DataTable {
  name?: string;
  meta?: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
}

export interface DataQueryResult {
  domain: QueryDomain;
  intent: string;
  dataType: "table" | "tables" | "single";
  meta: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  /** dataType 为 tables 时使用 */
  tables?: DataTable[];
}
