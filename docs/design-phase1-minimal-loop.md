## 阶段一详细设计：主 Orchestrator + 数据查询子智能体最小闭环

本阶段目标是在不引入复杂规划、多子 Agent 协作的前提下，先打通一条最小可运行链路：

> 用户输入 → 主 Orchestrator → DataQuery 子 Agent（内含会员/电商二级域路由） → 返回统一的 DataQueryResult → Orchestrator 组装最终输出。

**上下文协作规范**：

- 本阶段所有主/子 Agent 的上下文、State、产物（Artifacts）协作，统一遵守：
  - `docs/context-collaboration-spec.md`

---

### 一、阶段一范围与不做的事

#### 1.1 本阶段范围（做什么）

- 实现一个简化版 **Orchestrator 图**：
  - 负责基础的高层域识别（仅区分：`data_query` / 其他）；
  - 将数据查询类请求转发给 `DataQueryAgent`；
  - 收集 DataQueryAgent 的结果，组装为 `finalAnswer` 返回。
- 实现一个简化版 **DataQueryAgent 图**：
  - 支持在「数据查询」域内再区分两个二级业务域：
    - `member`：会员相关（如「查我的会员积分」）；
    - `ecommerce`：电商相关（如「查我最近的订单」）；
  - 每个二级域执行一条演示用 SQL（使用 DummyDbClient），将结果封装为统一的 `DataQueryResult`。
- 定义并固定以下接口与状态结构：
  - `OrchestratorInput` / `OrchestratorState`；
  - `DataQueryInput` / `DataQueryState` / `DataQueryResult`。

#### 1.2 本阶段暂不做的事

- 不引入 DataAnalysisAgent 与 SmartFormAgent（只保留概念，代码层不实现）；
- 不做真正的 SQL 生成与复杂查询，只用固定 SQL 模板示例；
- 不接入真实数据库/向量库，使用 Dummy 实现；
- 不实现完整的 DeepAgent 技能检索器，仅通过规则路由；
- 不对接完整的记忆系统，只在设计上预留位置。

---

### 二、接口定义

#### 2.0 主↔子协作协议（强制）

阶段一开始就采用统一的主↔子协作协议，避免后续扩展时重构：

- **主→子下发**：`SubTaskEnvelope`（落盘至 `artifacts/{threadId}/{taskId}/input.json`）
- **子→主回传**：`SubTaskResult`（`summary` + `data` + `artifacts` 引用）

约定：

- 本阶段 `SubTaskResult.data` 的业务数据为 `DataQueryResult`；
- 当查询结果较大（如行数很多）时，必须将大结果落盘并通过 `artifacts[]` 引用回传，主 State 不直接承载大表（遵守 `docs/context-collaboration-spec.md`）。

#### 2.1 OrchestratorInput / OrchestratorState

```ts
interface OrchestratorInput {
  userInput: string;
  userId?: string;
  channel?: string;
  env: EnvConfig;
}

interface OrchestratorState {
  input: OrchestratorInput;

  highLevelDomain?: "data_query" | "other";

  // 子任务结果索引：主图只存“精简摘要 + artifacts 引用”
  resultsIndex?: Record<
    string,
    {
      status: "success" | "failed" | "partial";
      summary: string;
      artifacts?: Array<{ id: string; path: string; type: string }>;
    }
  >;

  // 最近一次可复用的数据集引用（阶段一可为空；阶段三会用到）
  lastDataSetRef?: { id: string; path: string };

  finalAnswer?: unknown;
}
```

要点：

- 阶段一只区分 `data_query` 与 `other`，`other` 直接走 fallback；
- 未来扩展时可在 `highLevelDomain` 中增加 `data_analysis`、`smart_form` 等枚举，并在 State 中挂载更多子 Agent 的结果字段。

#### 2.2 DataQueryInput / DataQueryState / DataQueryResult

```ts
interface DataQueryInput {
  userInput: string;
  userId?: string;
  env: EnvConfig;
}

type QueryDomain = "member" | "ecommerce" | "other";

interface DataQueryState {
  input: DataQueryInput;

  queryDomain?: QueryDomain; // 会员/电商/其他
  queryIntent?: string;      // 规范化意图，例如 \"member_points_recent\"

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

interface DataQueryResult {
  domain: QueryDomain;
  intent: string;
  dataType: "table" | "single";
  meta: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
}
```

要点：

- `DataQueryInput` = Orchestrator 传给 DataQueryAgent 的统一输入结构；
- `DataQueryState` 既兼容后续扩展（更多 queryParams / executionPlan 字段），又足够简单用来跑 Demo；
- `DataQueryResult` 是 **DataQueryAgent 对外唯一承诺的结果格式**，供 Orchestrator 以及未来的 DataAnalysisAgent/SmartFormAgent 使用。

---

### 三、Orchestrator 图节点设计

Orchestrator 图在阶段一中仅包含 3 个节点：

1. `intent_agent`：粗粒度意图识别
2. `execute_data_query`：调用 DataQueryAgent
3. `compose_answer`：组装最终输出

**thread_id / taskId（强制）**：

- `thread_id` 放在图调用 `config.configurable.thread_id` 中（不放在 input/state 里）；
- `taskId` 由主 Agent 生成，用于 artifacts 归档与审计；
- artifacts 路径与 threadId/taskId 对齐：`artifacts/{threadId}/{taskId}/...`。

#### 3.1 intent_agent 节点

**输入**：`OrchestratorState`  
**输出**：更新 `highLevelDomain`

伪代码示意：

```ts
const intentAgentNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  const text = state.input.userInput;

  const isDataQuery =
    text.includes("查") ||
    text.includes("查询") ||
    text.includes("订单") ||
    text.includes("积分") ||
    text.includes("会员");

  return {
    ...state,
    highLevelDomain: isDataQuery ? "data_query" : "other",
  };
};
```

说明：

- 当前通过简单关键词规则判断是否为数据查询任务；
- 后续可替换为真正的 `IntentAgent` 或 DeepAgent 路由技能。

#### 3.2 execute_data_query 节点

**输入**：`OrchestratorState`  
**前置条件**：`highLevelDomain === "data_query"`  
**输出**：写入 `resultsIndex`（精简摘要 + artifacts 引用）

伪代码示意：

```ts
const executeDataQueryNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  if (state.highLevelDomain !== "data_query") {
    return state;
  }

  const taskId = createTaskId();
  const threadId = getThreadIdFromConfig(); // 来自 invoke config，而非 input

  const envelope: SubTaskEnvelope<DataQueryInput> = {
    taskId,
    threadId,
    agentType: "data_query",
    goal: "执行数据查询并返回统一 DataQueryResult",
    inputs: {
      userInput: state.input.userInput,
      userId: state.input.userId,
      env: state.input.env,
    },
    expectedOutputSchema: { name: "DataQueryResult", version: "1.0" },
  };

  // 1) 落盘 input.json：artifacts/{threadId}/{taskId}/input.json
  // writeArtifactInput(threadId, taskId, envelope)

  const subResult: SubTaskResult<DataQueryResult> = await runDataQueryAgent(envelope);

  // 2) 落盘 result.json / summary.md / debug.json
  // writeArtifactResult(threadId, taskId, subResult)

  return {
    ...state,
    resultsIndex: {
      ...(state.resultsIndex ?? {}),
      [taskId]: {
        status: subResult.status,
        summary: subResult.summary,
        artifacts: subResult.artifacts?.map((a) => ({ id: a.id, path: a.path, type: a.type })),
      },
    },
    // 可选：若 subResult 返回 dataset artifact，可写入 lastDataSetRef（阶段三使用）
    // lastDataSetRef: pickDatasetRef(subResult.artifacts),
  };
};
```

#### 3.3 compose_answer 节点

**输入**：`OrchestratorState`  
**输出**：填充 `finalAnswer`

伪代码示意：

```ts
const composeAnswerNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  if (state.resultsIndex && Object.keys(state.resultsIndex).length > 0) {
    return {
      ...state,
      finalAnswer: {
        type: "data_query",
        resultsIndex: state.resultsIndex,
      },
    };
  }

  return {
    ...state,
    finalAnswer: {
      type: "fallback",
      message: "当前仅支持简单的数据查询示例，请尝试询问订单或会员积分相关问题。",
    },
  };
};
```

---

### 三点五、Artifacts（文件系统落盘）要求（阶段一）

阶段一即要求具备最基础的落盘能力（便于后续规模化与审计）：

- 路径：`artifacts/{threadId}/{taskId}/...`
- 至少写入：
  - `input.json`（SubTaskEnvelope）
  - `result.json`（SubTaskResult）
  - `summary.md`（SubTaskResult.summary）
  - `debug.json`（可选，但推荐）

当查询结果较大时：

- 将表格写入 `data/table.jsonl` 或 `data/table.csv`；
- `result.json` 中仅保存少量 meta + 数据集引用（artifacts[]）。

---

### 四、DataQuery 图节点设计

DataQuery 图在阶段一中包含 2 个核心节点：

1. `data_query_domain_router`：在数据查询内路由会员/电商域；
2. `execute_query`：构造 SQL 并调用通用 SQL 技能，在 Dummy DB 上执行。

#### 4.1 data_query_domain_router 节点

**输入**：`DataQueryState`  
**输出**：更新 `queryDomain` / `queryIntent` / `queryParams`

伪代码示意：

```ts
const dataQueryDomainRouterNode = async (state: DataQueryState): Promise<DataQueryState> => {
  const text = state.input.userInput;

  let queryDomain: QueryDomain = "other";
  let queryIntent = "unknown";

  if (text.includes("会员") || text.includes("积分") || text.includes("等级")) {
    queryDomain = "member";
    queryIntent = "member_points_recent";
  } else if (text.includes("订单") || text.includes("物流") || text.includes("快递")) {
    queryDomain = "ecommerce";
    queryIntent = "ecom_orders_recent";
  }

  // 简化：不解析复杂条件，后续再扩展 queryParams

  return {
    ...state,
    queryDomain,
    queryIntent,
  };
};
```

#### 4.2 execute_query 节点

**输入**：`DataQueryState`  
**输出**：填充 `executionPlan` / `result`

伪代码示意：

```ts
const executeQueryNode = async (state: DataQueryState): Promise<DataQueryState> => {
  const db = new DummyDbClient();

  let sql = "";
  let params: unknown[] = [];

  if (state.queryDomain === "member" && state.queryIntent === "member_points_recent") {
    sql =
      "SELECT change, reason, created_at FROM member_points WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5";
    params = [state.input.userId ?? "demo-user"];
  } else if (state.queryDomain === "ecommerce" && state.queryIntent === "ecom_orders_recent") {
    sql =
      "SELECT order_id, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5";
    params = [state.input.userId ?? "demo-user"];
  } else {
    return {
      ...state,
      result: {
        domain: state.queryDomain ?? "other",
        intent: state.queryIntent ?? "unknown",
        dataType: "table",
        meta: { note: "no matching demo query" },
        rows: [],
      },
    };
  }

  const sqlResult = await runSqlQuerySkill({ sql, params }, db);

  const rows = sqlResult.rows;

  const result: DataQueryResult = {
    domain: state.queryDomain ?? "other",
    intent: state.queryIntent ?? "unknown",
    dataType: "table",
    meta: {}, // 可后续补充字段解释、单位等
    rows,
  };

  return {
    ...state,
    executionPlan: { sql, params },
    result,
  };
};
```

---

### 五、示例流程说明

#### 5.1 示例一：查询电商订单

**用户输入**：

> 「帮我查一下我最近的订单」

**执行链路**：

1. Orchestrator `intent_agent`：
   - 识别为 `highLevelDomain = "data_query"`；
2. Orchestrator `execute_data_query`：
   - 生成 `taskId/threadId`，构造 `SubTaskEnvelope(agentType=data_query)`；
   - 将 `input.json` 落盘到 `artifacts/{threadId}/{taskId}/input.json`；
   - 调用 `runDataQueryAgent(envelope)` 并获得 `SubTaskResult(DataQueryResult)`；
   - 将 `result.json/summary.md` 落盘，并把摘要与 artifacts 引用写入 `resultsIndex`；
3. DataQuery 图 `data_query_domain_router`：
   - 识别为 `queryDomain = "ecommerce"`，`queryIntent = "ecom_orders_recent"`；
4. DataQuery 图 `execute_query`：
   - 构造订单查询 SQL，调用 `runSqlQuerySkill`；
   - 将结果封装为 `DataQueryResult`，回写 `DataQueryState.result`；
5. Orchestrator 收到子任务结果：
   - `compose_answer` 节点基于 `resultsIndex` 生成 `{ type: "data_query", resultsIndex: ... }`；
   - 作为 `finalAnswer` 返回给调用方。

#### 5.2 示例二：查询会员积分

**用户输入**：

> 「查一下我的会员积分记录」

流程与上述类似，只是 `data_query_domain_router` 将其路由到 `member` 域，执行的是积分变动查询 SQL。

---

### 六、阶段一交付物总结

1. **图与状态定义**：
   - Orchestrator 图：3 个节点 + OrchestratorState；
   - DataQuery 图：2 个节点 + DataQueryState / DataQueryResult。
2. **接口规范**：
   - `runOrchestratorAgent(input: OrchestratorInput)`；
   - `runDataQueryAgent(input: DataQueryInput)`。
3. **运行演示**：
   - 在 `src/index.ts` 中调用 `runOrchestratorAgent`，传入示例 `userInput` 与 fake `userId`，通过日志输出 `finalAnswer`；
   - 确认会员/电商两个二级域的最小闭环均能跑通。

在本阶段打通闭环之后，可以在后续阶段逐步引入 DataAnalysisAgent、SmartFormAgent、DeepAgent 技能检索以及记忆系统，保持接口与 State 向前兼容。

