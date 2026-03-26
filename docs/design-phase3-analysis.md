## 阶段三（A3）详细设计文档：引入 DataAnalysisAgent 与多步协作

本阶段在阶段一「主 Orchestrator + DataQuery 子智能体最小闭环」与阶段二「技能注册与动态披露」基础之上，新增 **数据分析子智能体（DataAnalysisAgent）**，支持典型「查 + 分析」组合任务：

> 例如：「帮我查 6 月 GMV 并分析和 5 月差异」、「看一下最近 7 天订单走势，有没有异常？」。

目标是验证主 Agent 如何在一个任务中**串联多个子 Agent**（至少 DataQuery + DataAnalysis），并定义清晰的输入输出协议与 State 传递方式。

**上下文协作规范**：

- 本阶段主/子 Agent 的上下文隔离、State 协作、文件系统产物（Artifacts）落盘与引用，统一遵守：
  - `docs/context-collaboration-spec.md`

---

### 一、阶段目标与范围

#### 1.1 阶段目标

1. **引入 DataAnalysisAgent**：
   - 为数据分析场景设计统一接口（Input/State/Result）；
   - 在 DataAnalysisAgent 内实现最小可用的分析图（分析类型识别 → 计算 → 文本生成）。

2. **扩展 Orchestrator**：
   - 在阶段一的基础上，扩展 Orchestrator 支持：
     - 区分 `data_query` 与 `data_analysis` 两类高层意图；
     - 在「查 + 分析」的任务中，按顺序先调用 DataQueryAgent，再调用 DataAnalysisAgent；
     - 将查询结果与分析结果汇总为统一的 `finalAnswer`。

3. **保持接口向前兼容**：
   - 对阶段一已有的接口和 State 尽量保持兼容，便于后续增量迁移。

#### 1.2 阶段范围（Do）

- 扩展 Orchestrator：
  - 定义新的高层域类型 `HighLevelDomain`；
  - 在 State 中加入 `resultsIndex` 与 `lastDataSetRef` 字段（只存索引与引用，不存大结果）；
  - 增加 `requireQueryBeforeAnalysis` 标志位，用于表达「先查再分析」的计划。

- 实现 DataAnalysisAgent：
  - `DataAnalysisInput` / `DataAnalysisState` / `DataAnalysisResult`；
  - 支持至少 1 种分析类型（如 GMV 同比/环比分析），可使用简单算术 + LLM 生成解读。

- 为「查 + 分析」场景定义一条示例执行链路。

#### 1.3 阶段范围外（Not Do）

- 不实现复杂统计或机器学习分析算法，分析逻辑保持简单可解释；
- 不引入 SmartFormAgent 的实际实现，只在接口规划中预留位置；
- 不对接真实 BI/可视化系统，仅返回结构化数据与文字说明；
- 不在本阶段重复实现技能检索基础设施（见阶段二）；分析子图内以规则 + 已注册技能为主。

---

### 二、接口与 State 设计

#### 2.1 扩展 OrchestratorInput / OrchestratorState

在阶段一的基础上，扩展高层域与新增字段：

```ts
type HighLevelDomain = "data_query" | "data_analysis" | "smart_form" | "other";

interface OrchestratorInput {
  userInput: string;
  userId?: string;
  channel?: string;
  env: EnvConfig;
}

interface OrchestratorState {
  input: OrchestratorInput;

  highLevelDomain?: HighLevelDomain;

  // 子任务结果索引：主图只存“精简摘要 + artifacts 引用”
  resultsIndex?: Record<
    string,
    {
      status: "success" | "failed" | "partial";
      summary: string;
      artifacts?: Array<{ id: string; path: string; type: string }>;
    }
  >;

  // 最近一次可复用的数据集引用（通过文件系统 artifacts 引用）
  lastDataSetRef?: { id: string; path: string };

  // 是否需要在分析前先执行一次查询（查 + 分析）
  requireQueryBeforeAnalysis?: boolean;

  finalAnswer?: unknown;
}
```

设计要点：

- `HighLevelDomain` 为未来保留 `smart_form` 等域，阶段三主要使用 `data_query` 与 `data_analysis`；
- `lastDataSetRef` 存储最近一次查询结果的文件引用，供 DataAnalysisAgent 使用；
- `requireQueryBeforeAnalysis` 显式描述当前任务是否需要「先查再分析」。

#### 2.2 DataAnalysisInput / DataAnalysisState / DataAnalysisResult

```ts
interface DataAnalysisInput {
  userInput: string;
  userId?: string;
  env: EnvConfig;

  // 规范：优先使用 artifact 引用（避免把大数据塞进 state/prompt）
  dataSetRef?: { id: string; path: string };

  // 可选：仅在数据很小、可控时允许内联（不推荐作为默认路径）
  dataSetInline?: DataQueryResult;
}

type AnalysisType = "compare_period" | "trend" | "simple_summary" | "other";

interface DataAnalysisState {
  input: DataAnalysisInput;

  analysisType?: AnalysisType;

  // 从数据集中抽取的关键字段（指标、维度、时间范围等）
  analysisParams?: {
    metric?: string;
    timeRange?: { start: string; end: string };
    // 其他分析参数可按需扩展
  };

  result?: DataAnalysisResult;
}

interface DataAnalysisResult {
  type: AnalysisType;
  metric?: string;
  valueSummary?: Record<string, unknown>; // 如 { current: 1200, previous: 1000, diff: 200, diffRate: 0.2 }
  insights: string;                        // LLM 生成的自然语言结论
}
```

设计要点：

- DataAnalysisAgent 优先消费 `dataSetRef`：
  - 通过文件系统读取 `artifacts/...` 中的数据集（如 table.jsonl/csv）；
  - 若仅有 `dataSetInline`，仅在小数据场景使用。
- `AnalysisType`：预定义若干常见分析类型，后续可扩展；
- `valueSummary`：以结构化形式保存计算结果，便于前端展示或后续处理；
- `insights`：给人看的自然语言结果。

---

### 三、Orchestrator 图扩展设计（Phase 3）

#### 3.1 新增/调整节点

在阶段一的基础上，Orchestrator 图将包含如下节点：

1. `intent_agent`：高层意图与是否需要先查询的识别；
2. `execute_data_query`：执行数据查询（在 `data_query` 域或需要先查后分析的任务中触发）；
3. `execute_data_analysis`：调用 DataAnalysisAgent 进行分析；
4. `compose_answer`：整合查询结果与分析结果，生成最终输出。

其中：

- 对于纯数据查询任务：只走 `intent_agent → execute_data_query → compose_answer`；
- 对于查 + 分析任务：走 `intent_agent → execute_data_query → execute_data_analysis → compose_answer`；
- 对于「仅分析」但没有提供数据集的任务：目前可提示「需要先查询」，后续可自动补查。

#### 3.2 intent_agent 节点扩展逻辑

**输入**：`OrchestratorState`  
**输出**：`highLevelDomain`、`requireQueryBeforeAnalysis`

伪代码：

```ts
const intentAgentNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  const text = state.input.userInput;

  const hasAnalysisWords =
    text.includes("分析") ||
    text.includes("对比") ||
    text.includes("同比") ||
    text.includes("环比") ||
    text.includes("趋势") ||
    text.includes("走势");

  const isDataQuery =
    text.includes("查") ||
    text.includes("查询") ||
    text.includes("订单") ||
    text.includes("积分") ||
    text.includes("会员");

  let highLevelDomain: HighLevelDomain = "other";
  let requireQueryBeforeAnalysis = false;

  if (hasAnalysisWords && isDataQuery) {
  // 典型的「查 + 分析」场景
    highLevelDomain = "data_analysis";
    requireQueryBeforeAnalysis = true;
  } else if (hasAnalysisWords) {
    highLevelDomain = "data_analysis";
  } else if (isDataQuery) {
    highLevelDomain = "data_query";
  }

  return {
    ...state,
    highLevelDomain,
    requireQueryBeforeAnalysis,
  };
};
```

说明：

- 本阶段采用规则识别即可，后续可用 IntentAgent 或 DeepAgent 路由技能替换。

#### 3.3 execute_data_query 节点（扩展版）

在阶段三中，`execute_data_query` 不仅用于独立查询，还为分析任务提供 `lastDataSetRef`（文件系统引用）。

伪代码：

```ts
const executeDataQueryNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  // 两种情况需要执行查询：
  // 1）顶层就是 data_query
  // 2）顶层是 data_analysis，但 requireQueryBeforeAnalysis = true
  if (
    state.highLevelDomain !== "data_query" &&
    !state.requireQueryBeforeAnalysis
  ) {
    return state;
  }

  // 阶段三建议仍通过 SubTaskEnvelope / SubTaskResult 执行子任务，并落盘 artifacts
  const taskId = createTaskId();
  const threadId = getThreadIdFromConfig();

  const envelope: SubTaskEnvelope<DataQueryInput> = {
    taskId,
    threadId,
    agentType: "data_query",
    goal: "执行数据查询并返回统一 DataQueryResult（大结果落盘并返回引用）",
    inputs: {
      userInput: state.input.userInput,
      userId: state.input.userId,
      env: state.input.env,
    },
    expectedOutputSchema: { name: "DataQueryResult", version: "1.0" },
  };

  const subResult: SubTaskResult<DataQueryResult> = await runDataQueryAgent(envelope);

  // resultsIndex：记录摘要与 artifacts
  const nextResultsIndex = {
    ...(state.resultsIndex ?? {}),
    [taskId]: {
      status: subResult.status,
      summary: subResult.summary,
      artifacts: subResult.artifacts?.map((a) => ({ id: a.id, path: a.path, type: a.type })),
    },
  };

  // lastDataSetRef：优先指向 dataset/table 类 artifact（供分析复用）
  const datasetArtifact = subResult.artifacts?.find((a) => a.type === "dataset" || a.type === "table");

  return {
    ...state,
    resultsIndex: nextResultsIndex,
    lastDataSetRef: datasetArtifact ? { id: datasetArtifact.id, path: datasetArtifact.path } : state.lastDataSetRef,
  };
};
```

#### 3.4 execute_data_analysis 节点

**输入**：`OrchestratorState`  
**输出**：写入 `resultsIndex`（精简摘要 + artifacts 引用）

伪代码：

```ts
const executeDataAnalysisNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  if (state.highLevelDomain !== "data_analysis") {
    return state;
  }

  const analysisTaskId = createTaskId();
  const threadId = getThreadIdFromConfig();

  const analysisEnvelope: SubTaskEnvelope<DataAnalysisInput> = {
    taskId: analysisTaskId,
    threadId,
    agentType: "data_analysis",
    goal: "基于上一步数据集引用进行分析并返回 DataAnalysisResult（必要产物落盘）",
    inputs: {
      userInput: state.input.userInput,
      userId: state.input.userId,
      env: state.input.env,
      dataSetRef: state.lastDataSetRef,
    },
    expectedOutputSchema: { name: "DataAnalysisResult", version: "1.0" },
  };

  const analysisResult = await runDataAnalysisAgent(analysisEnvelope);

  const nextResultsIndex = {
    ...(state.resultsIndex ?? {}),
    [analysisTaskId]: {
      status: analysisResult.status,
      summary: analysisResult.summary,
      artifacts: analysisResult.artifacts?.map((a) => ({ id: a.id, path: a.path, type: a.type })),
    },
  };

  return {
    ...state,
    resultsIndex: nextResultsIndex,
  };
};
```

#### 3.5 compose_answer 节点扩展版

**输入**：`OrchestratorState`  
**输出**：`finalAnswer`

伪代码：

```ts
const composeAnswerNode = async (state: OrchestratorState): Promise<OrchestratorState> => {
  // 阶段三建议以 resultsIndex + lastDataSetRef 作为主状态基准
  if (state.highLevelDomain === "data_analysis") {
    return {
      ...state,
      finalAnswer: {
        type: "data_analysis",
        lastDataSetRef: state.lastDataSetRef,
        resultsIndex: state.resultsIndex,
      },
    };
  }

  if (state.highLevelDomain === "data_query") {
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
      message: "当前仅实现了数据查询与简单分析示例，请尝试询问 GMV/订单类问题。",
    },
  };
};
```

#### 3.6 节点连线示例

典型连线（简化）：

- 仅查询：
  - `START → intent_agent → execute_data_query → compose_answer → END`
- 查 + 分析：
  - `START → intent_agent → execute_data_query → execute_data_analysis → compose_answer → END`

在具体实现中，可用条件边控制是否进入某个节点。

---

### 四、DataAnalysis 图设计（Phase 3）

#### 4.1 节点列表（最小版本）

1. `analysis_type_router`：根据 `userInput` 和可选 `dataSet` 判定分析类型；
2. `analysis_executor`：执行核心数值分析逻辑；
3. `narrative_generator`：调用 LLM 生成文字解读。

#### 4.2 节点行为定义

**4.2.1 analysis_type_router**

输入：`DataAnalysisState`  
输出：`analysisType`、初步 `analysisParams`

伪代码示意：

```ts
const analysisTypeRouterNode = async (state: DataAnalysisState): Promise<DataAnalysisState> => {
  const text = state.input.userInput;

  let analysisType: AnalysisType = "simple_summary";

  if (text.includes("同比") || text.includes("环比") || text.includes("对比")) {
    analysisType = "compare_period";
  } else if (text.includes("趋势") || text.includes("走势")) {
    analysisType = "trend";
  }

  // 简化实现：后续可从 dataSet.meta 中提取 metric / timeRange

  return {
    ...state,
    analysisType,
  };
};
```

**4.2.2 analysis_executor**

输入：`DataAnalysisState`  
输出：`DataAnalysisResult` 中的 `valueSummary`

伪代码示意（compare_period 示例）：

```ts
const analysisExecutorNode = async (state: DataAnalysisState): Promise<DataAnalysisState> => {
  const { analysisType, input } = state;
  const dataSet = input.dataSet;

  if (!dataSet || !dataSet.rows || dataSet.rows.length === 0) {
    return {
      ...state,
      result: {
        type: analysisType ?? "other",
        insights: "没有可供分析的数据，请先执行数据查询。",
      },
    };
  }

  let valueSummary: Record<string, unknown> | undefined;

  if (analysisType === "compare_period") {
    // 假设前两行分别代表前一周期和当前周期
    const [previous, current] = dataSet.rows;
    const prevValue = Number(previous.value ?? 0);
    const currValue = Number(current.value ?? 0);
    const diff = currValue - prevValue;
    const diffRate = prevValue !== 0 ? diff / prevValue : null;

    valueSummary = {
      previous: prevValue,
      current: currValue,
      diff,
      diffRate,
    };
  } else if (analysisType === "trend") {
    // 简单判断趋势（示例：只看首尾）
    const first = Number(dataSet.rows[0].value ?? 0);
    const last = Number(dataSet.rows[dataSet.rows.length - 1].value ?? 0);
    const trend = last > first ? "up" : last < first ? "down" : "flat";

    valueSummary = {
      first,
      last,
      trend,
    };
  } else {
    // simple_summary：提取一个简单的统计信息
    const values = dataSet.rows.map((r) => Number(r.value ?? 0));
    const sum = values.reduce((acc, v) => acc + v, 0);
    valueSummary = {
      sum,
      count: values.length,
      avg: values.length ? sum / values.length : 0,
    };
  }

  return {
    ...state,
    result: {
      ...(state.result ?? {}),
      type: analysisType ?? "other",
      metric: dataSet.meta?.metric as string | undefined,
      valueSummary,
      insights: "", // 先留空，交给 narrative_generator 填充
    },
  };
};
```

**4.2.3 narrative_generator**

输入：`DataAnalysisState.result`（含 `valueSummary` 等）  
输出：填充 `insights`

伪代码（伪 LLM 调用）：

```ts
const narrativeGeneratorNode = async (state: DataAnalysisState): Promise<DataAnalysisState> => {
  if (!state.result) {
    return state;
  }

  const prompt = buildAnalysisPrompt(state.result); // 拼一个 prompt，总结 valueSummary
  const insights = await callLLM(prompt); // 这里可以用 LangChain 的 LLM 接口

  return {
    ...state,
    result: {
      ...state.result,
      insights,
    },
  };
};
```

#### 4.3 节点连线

- `START → analysis_type_router → analysis_executor → narrative_generator → END`

---

### 五、典型执行流程示例

#### 5.1 示例：查 5 月和 6 月 GMV 并分析差异

**用户输入**：

> 「帮我查一下 5 月和 6 月的 GMV 并分析差异」

**执行链路**：

1. Orchestrator `intent_agent`：
   - 检测到「查」+「分析/差异」：
     - `highLevelDomain = "data_analysis"`
     - `requireQueryBeforeAnalysis = true`

2. Orchestrator `execute_data_query`：
   - 使用 `SubTaskEnvelope(agentType=data_query)` 下发子任务，并将 `input.json` 落盘；
   - DataQueryAgent 返回 `SubTaskResult(DataQueryResult)`，并将 `result.json/summary.md` 落盘；
   - Orchestrator 将其写入 `resultsIndex`，并从 `artifacts[]` 中提取 dataset/table 引用写入 `lastDataSetRef`。

3. Orchestrator `execute_data_analysis`：
   - 使用 `SubTaskEnvelope(agentType=data_analysis)` 下发分析子任务，其中 `inputs.dataSetRef = lastDataSetRef`；
   - 调用 `runDataAnalysisAgent`（子 Agent 通过文件系统读取数据集 artifact）；
   - DataAnalysisAgent：
     - `analysis_type_router`：识别为 `compare_period`；
     - `analysis_executor`：计算前后差值与增幅；
     - `narrative_generator`：生成自然语言结论；
   - 返回 `SubTaskResult(DataAnalysisResult)`，Orchestrator 写入 `resultsIndex`（含摘要与 artifacts 引用）。

4. Orchestrator `compose_answer`：
   - 将 `lastDataSetRef` + `resultsIndex` 组合为：

```json
{
  "type": "data_analysis",
  "lastDataSetRef": { "id": "dataset-xxx", "path": "artifacts/..." },
  "resultsIndex": { "...": { "status": "success", "summary": "...", "artifacts": [] } }
}
```

   - 作为 `finalAnswer` 返回给调用方。

---

### 六、阶段三交付物总结

1. **接口与 State**：
   - 扩展后的 `OrchestratorState`（高层域、resultsIndex、lastDataSetRef、requireQueryBeforeAnalysis）；
   - DataAnalysisAgent 的 `DataAnalysisInput` / `DataAnalysisState` / `DataAnalysisResult`。

2. **图结构**：
   - Orchestrator 图新增 `execute_data_analysis`，并完善条件边；
   - DataAnalysis 图新增 3 个节点（analysis_type_router / analysis_executor / narrative_generator）。

3. **示例任务**：
   - 至少支持 1 个「查 + 分析」场景（如 5 月 vs 6 月 GMV 差异分析）。

在阶段三完成后，系统即可支持「先查数再分析」的完整闭环，为阶段四（SmartFormAgent）以及阶段五（DeepAgent 深度整合、记忆集成等）的实现打下基础。

> **相关文档**：阶段一见 `design-phase1-minimal-loop.md`；阶段二技能体系见 `design-phase2-skills-disclosure.md` 与 `skills-dynamic-disclosure-spec.md`。

