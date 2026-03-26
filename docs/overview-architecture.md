## DeepAgent 多智能体系统总体架构说明

### 一、系统总体目标

- **统一的多智能体编排平台**：基于 **LangChain DeepAgent + LangGraph** 搭建一套多智能体系统，支持：
  - **数据查询（Data Query）**：面向会员、电商等多业务域的数据读取与聚合；
  - **数据分析（Data Analysis）**：在已有数据基础上进行指标计算、趋势分析、异常检测与洞察生成；
  - **智能表单（Smart Form）**：围绕表单的生成、自动填充与合规校验。
- **主从协作**：通过一个「主 Agent（总指挥 / 项目经理）」统一接收需求、拆解任务、调度子 Agent，并整合输出。
- **可扩展技能体系**：支撑从几十到上千个 Skills，通过「**分层 + 路由 + 向量检索 + 渐进式披露**」控制上下文体积与决策质量。
- **可观测与可治理**：对主 Agent 与子 Agent 的执行路径、使用的技能/工具、关键中间结果提供可追溯记录，便于优化与运维。

---

### 零、统一协作规范（强制）

为避免主/子 Agent 上下文污染、State 膨胀与结果不可追溯，本系统将 **上下文协作** 抽象为强制规范，并要求所有阶段设计与实现遵守：

- `docs/context-collaboration-spec.md`

核心约束摘要：

- **Messages / State / Artifacts 三分离**：大结果一律落盘（文件系统 artifacts），State 只存索引与引用；
- **主→子、子→主统一协议**：`SubTaskEnvelope`（下发）与 `SubTaskResult`（回传）；
- **thread_id 放在调用 config**（`configurable.thread_id`），不放在 input/state 结构里。

---

### 二、总部架构（分层视图）

整体系统按职责划分为四层：

1. **交互层（Interface Layer）**
   - 入口形态：CLI / HTTP API / Web / IM Bot（微信/飞书/企业微信等）。
   - 职责：接收用户请求，将其封装为 `OrchestratorInput` 传给主 Agent；接收 `finalAnswer` 后转为对应渠道的展示形式。

2. **编排层（Orchestration Layer）**
   - 核心组件：**主 Agent（Orchestrator）**，基于 LangGraph（DeepAgent 作为运行时能力）。
   - 职责：
     - 任务理解与规划（意图识别 + 可选 Planner / Plan-and-Execute）；
     - 子 Agent 调度（串行 / 并行）；
     - 状态管理（OrchestratorState + LangGraph checkpointer）；
     - 结果整合、异常处理与最终输出。

3. **子智能体层（Domain Agents Layer）**
   - 典型子 Agent：
     - `DataQueryAgent`：数据查询智能体，负责从不同业务域（会员、电商、财务等）抽象出统一的数据查询接口；
     - `DataAnalysisAgent`：数据分析智能体，基于结构化数据进行计算与洞察生成；
     - `SmartFormAgent`：智能表单智能体，负责表单 schema 设计、自动填充和规则校验。
   - 每个子 Agent 自己内部可以再拆一张子图（子 StateGraph），实现更细粒度的路由与执行。

4. **能力与资源层（Skills & Infra Layer）**
   - **通用技能（Core Skills）**：
     - `skill-sql-query`：统一 SQL 查询能力；
     - `skill-knowledge-base`：向量检索 / 知识库检索；
     - `skill-web-search`：外部搜索（可选）；
     - `skill-file-read-write`：文件系统读写（用于中间结果落盘）。
   - **业务技能（Domain Skills）**：
     - 针对具体业务场景的技能，如「电商订单查询」「会员积分查询」「费用报销查询」等；
   - **路由与技能检索技能（Routing & Retriever Skills）**：
     - 大类路由技能：`skill-route-domain`（识别 data_query / data_analysis / smart_form …）；
     - 域内路由技能：`skill-route-data-query`（在数据查询内区分会员/电商等）、`skill-route-smart-form` 等；
     - 技能检索器技能：`skill-skill-retriever`，用于按向量相似度召回 TopN 相关技能。
   - **基础设施（Infra）**：
     - 数据库客户端（Postgres/MySQL/…）；
     - 向量库（Pinecone / Qdrant / Chroma 等）；
     - 外部服务 API（报表服务、BI 系统等）。
   - **Artifacts Store（文件系统）**：
     - 将大表格/长文本/报告等产物落盘到 `artifacts/{threadId}/{taskId}/...`；
     - 主 Agent 仅保存 artifact 引用（path/id/摘要），避免 State 膨胀。

---

### 三、主 / 子智能体协作模式

#### 3.1 主 Agent（Orchestrator）的职责

- **任务接收与理解**：接收 `userInput`（自然语言）、`userId`、`channel` 等上下文；
- **高层意图识别**：
  - 调用 `IntentAgent` 或路由技能，确定顶层域：`data_query` / `data_analysis` / `smart_form` / `other`；
- **任务拆解与规划**：
  - 简单任务：直接将请求路由到对应子 Agent；
  - 复杂任务：通过 Planner（如 DeepAgent 内置 `write_todos` 能力）将任务拆解为多步；支持 Plan-and-Execute。
- **子 Agent 调度**：
  - 按规划结果，将子任务分配给 `DataQueryAgent`、`DataAnalysisAgent`、`SmartFormAgent` 等；
  - 支持串行（有依赖）与并行（无依赖）执行。
- **状态与记忆管理**：
  - 通过 `OrchestratorState` 管理任务级状态；
  - 通过 LangGraph checkpointer + `thread_id` 管理会话级/任务级 checkpoint；
  - 可选集成业务记忆系统（如 `IntentMemorySystem`），记忆常见意图与工具选择偏好。
- **结果整合与输出**：
  - 收集各子 Agent 的 `SubTaskResult`（其中 `data` 为标准化 Result：DataQueryResult / DataAnalysisResult / SmartFormResult）；
  - 若结果较大，通过 `artifacts` 引用落盘产物；
  - 进行逻辑整合、交叉校验、一致性检查；
  - 生成统一对外的 `finalAnswer`，包含结构化数据和自然语言解释。

#### 3.2 子 Agent 的职责与边界

**共同原则**：

- 每个子 Agent 拥有独立的内部上下文和状态（独立的图与 State）；
- 对外只暴露清晰的输入 / 输出接口（`XXXInput` / `XXXResult`）；
- 子 Agent 内部可以自由使用多种技能和工具，但返回给主 Agent 的结果应**精简、结构化、稳定**；
- 子 Agent 不直接互相调用，只通过主 Agent 进行间接协作，避免耦合。

**示例：DataQueryAgent**

- 对外接口（建议）：`runDataQueryAgent(envelope: SubTaskEnvelope<DataQueryInput>): Promise<SubTaskResult<DataQueryResult>>`；
- 内部职责：
  - 通过 `data_query_domain_router` 区分会员域 / 电商域 / 财务域等；
  - 根据域和意图决定使用哪个/哪些业务技能（如会员积分查询、电商订单查询）；
  - 通过通用技能（如 `skill-sql-query`）访问数据库；
  - 返回统一结构的 `DataQueryResult`（包含 domain、intent、数据形态、字段信息、数据行）。

**示例：DataAnalysisAgent**

- 接收一个或多个 `DataQueryResult` 作为输入；
- 对数据进行统计分析（同比、环比、TopN、异常检测等）；
- 输出 `DataAnalysisResult`，包括数值结果与自然语言洞察。

**示例：SmartFormAgent**

- 接收场景描述、已有上下文（如用户信息、最近查询结果）；
- 生成表单 schema，自动填充部分字段，执行规则校验；
- 输出 `SmartFormResult`（schema + values + validation）。

---

### 四、统一 State 设计与传递

#### 4.1 OrchestratorState（主图）

Orchestrator 图中的共享状态建议包含：

```ts
interface OrchestratorState {
  input: {
    userInput: string;
    userId?: string;
    channel?: string;
    env: EnvConfig;
  };

  highLevelDomain?: "data_query" | "data_analysis" | "smart_form" | "other";

  // 子任务结果索引：只存“精简摘要 + artifacts 引用”，不存大结果
  resultsIndex?: Record<
    string,
    {
      status: "success" | "failed" | "partial";
      summary: string;
      artifacts?: Array<{ id: string; path: string; type: string }>;
    }
  >;

  // 最近一次可复用的数据集引用（用于 A2: 查 + 分析 等场景）
  lastDataSetRef?: { id: string; path: string };

  finalAnswer?: unknown;
}
```

要点：

- Orchestrator 只负责「顶层域」与「各子 Agent 已精简好的 Result」，不关心子 Agent 内部细节；
- `resultsIndex / lastDataSetRef` 用于跨步复用与审计回放，避免将大数据塞进 State。

#### 4.2 DataQueryState（子图）

数据查询子图可使用类似结构：

```ts
type QueryDomain = "member" | "ecommerce" | "finance" | "other";

interface DataQueryState {
  input: {
    userInput: string;
    userId?: string;
    env: EnvConfig;
  };

  queryDomain?: QueryDomain;  // 会员 / 电商 / 财务 / …
  queryIntent?: string;       // 规范化意图，如 \"member_points_recent\"

  queryParams?: {
    dateRange?: { start: string; end: string };
    dimensions?: string[];
    filters?: Record<string, unknown>;
  };

  executionPlan?: {
    sql?: string;
    params?: unknown[];
  };

  result?: DataQueryResult;
}
```

统一的数据查询返回结构：

```ts
interface DataQueryResult {
  domain: QueryDomain;
  intent: string;
  dataType: "table" | "timeseries" | "single";
  meta: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
}
```

其他子 Agent（分析、表单）亦可按类似模式定义自己的 State 和 Result 类型。

---

### 五、关键设计点

1. **路由分层**
   - 顶层：Orchestrator / IntentAgent 只路由到 `data_query` / `data_analysis` / `smart_form` 等大类；
   - 域内：DataQueryAgent、DataAnalysisAgent、SmartFormAgent 内部各自有小路由技能（如会员/电商、趋势/对比、报销/工单等）。

2. **结果精简回传**
   - 子 Agent 内部可以使用丰富的上下文和工具，但返回主 Agent 的只是一份结构化的 Result + 必要解读；
   - 避免在 OrchestratorState 中累积过多无关细节，减小上下文与记忆压力。

3. **技能体系与渐进式披露**
   - 通用技能写成底层能力，供所有子 Agent 复用；
   - 业务技能拆小、解耦、专一，按业务域归类；
   - 通过路由技能 + 向量检索控制「每次只给模型看少量候选技能」，避免 1000+ 技能堆叠导致的混乱。

4. **记忆系统集成**
   - 短期记忆：通过 LangGraph checkpointer + `thread_id` 保存执行中间状态和最后 checkpoint；
   - 长期/业务记忆：通过 IntentMemorySystem（参考 `docs/记忆.md`）记忆高频意图与工具组合，在 `intent_agent` 与子 Agent 路由节点中查询/写入。

5. **可观测性与治理**
   - 主/子 Agent 的执行路径、选择的技能、关键输入/输出均应在日志或监控中清晰记录；
   - 关键节点（如工具调用）可以附带 traceId / spanId 便于追踪。

---

本文件作为整个 DeepAgent 多智能体系统的**总体架构说明书**，后续的各阶段详细设计文档将在此基础上展开，建议顺序为：**阶段一**最小闭环（`design-phase1-minimal-loop.md`）→ **阶段二**技能注册与动态披露（`design-phase2-skills-disclosure.md`）→ **阶段三**数据分析与「查 + 分析」（`design-phase3-analysis.md`）→ 后续智能表单、DeepAgent 深度整合与记忆等。

