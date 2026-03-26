## 主 / 子 Agent 上下文统一协作规范（文件系统版）

本规范定义主 Agent（Orchestrator）与多个子 Agent（DataQuery / DataAnalysis / SmartForm 等）在 **上下文、State、产物（Artifacts）** 三个维度的协作方式，目标是：

- **主 Agent 上下文不被污染**：主 Agent 不承载各子 Agent 的细节推理与中间状态；
- **子 Agent 独立可执行**：子 Agent 得到“足够但最少”的信息完成子任务；
- **结果可追溯、可复用**：所有关键中间结果可落盘并可被后续步骤复用；
- **规模可扩展**：支持技能/子 Agent 增长而不导致 Prompt/State 膨胀失控。

---

### 一、术语与对象

- **主 Agent（Orchestrator）**：总指挥/项目经理。负责接收需求、拆解计划、调度子 Agent、汇总输出。
- **子 Agent（Domain Agent）**：专职执行者。如数据查询、数据分析、智能表单。
- **State（状态）**：LangGraph 在图节点间传递/合并的结构化对象。
- **Artifacts（产物）**：大体积数据/文本/表格/图表等，不应长期放在主 Agent 的上下文或 State 中。
- **thread_id**：会话/任务线标识，用于 checkpointer 隔离与恢复（放在调用 config 中，不放在 input）。

---

### 二、上下文统一原则：对话、状态、产物三分离

#### 2.1 对话上下文（Messages）

- **主 Agent 保留**：
  - 当前用户请求；
  - 最近 \(N\) 轮关键信息（或一个短“会话摘要”）。
- **子 Agent 接收**：
  - 与本子任务直接相关的片段（尽量短）；
  - 或主 Agent 生成的结构化 `goal + inputs`，减少大段对话复制。

> 结论：不要把完整聊天历史在主/子之间来回拷贝。主 Agent 负责“压缩摘要”，子 Agent 负责“任务执行”。

#### 2.2 状态上下文（State）

State 只存放**结构化、可合并、可审计**的信息。

- **主 Agent State**：只存“计划索引 + 子结果索引 + 关键引用”；
- **子 Agent State**：存域内路由、SQL/检索计划、计算中间量等局部细节；
- **回传给主 Agent**：只回传标准化的 `Result`，不回传子 Agent 全量局部 State。

#### 2.3 产物上下文（Artifacts）

当结果很大（表格行很多、文本很长、图表数据等）时：

- 写入**文件系统**作为 artifact；
- 主 Agent State 仅保存 **artifact 引用**（路径/ID/摘要）。

---

### 三、文件系统作为 Artifact Store 的规范

#### 3.1 目录结构

建议统一放在项目根目录的 `artifacts/`（可配置）：

```text
artifacts/
  {threadId}/
    {taskId}/
      input.json
      result.json
      summary.md
      debug.json
      data/
        table.jsonl
        table.csv
      attachments/
        chart.png
```

#### 3.2 文件约定

- **`input.json`**：主→子下发的任务 envelope（见下文）；
- **`result.json`**：子 Agent 的结构化 `data`（严格 schema）；
- **`summary.md`**：子 Agent 的短总结（主 Agent 可直接引用）；
- **`debug.json`**：工具/技能调用、耗时、警告等（面向审计与排障）；
- 大表格可写 `data/table.jsonl` 或 `data/table.csv`，避免一次性读入内存。

#### 3.3 可复用规则

同一 `threadId` 内后续步骤想复用数据：

- 主 Agent 仅传递 `artifactRef`（如 `path`），不重复传大数据；
- 子 Agent 在执行时按需读取对应 artifact 文件。

---

### 四、主→子：统一任务下发协议（SubTaskEnvelope）

所有子 Agent 统一使用结构化任务 envelope，避免纯自然语言导致歧义与上下文污染。

```ts
interface SubTaskEnvelope<TInputs = unknown> {
  taskId: string;
  threadId: string;

  agentType: "data_query" | "data_analysis" | "smart_form" | string;

  goal: string;
  inputs: TInputs;                 // 结构化输入：如 userId、dateRange、metric 等
  constraints?: Record<string, unknown>; // 白名单、上限、超时、返回格式等

  context?: {
    channel?: string;
    userSummary?: string;          // 可选：用户画像/偏好摘要
    conversationSummary?: string;  // 可选：会话摘要（短）
    refs?: Array<{ type: string; id: string; path?: string }>; // 指向 artifact 的引用
  };

  expectedOutputSchema: {
    name: string;                  // 如 DataQueryResult
    version: string;               // schema 版本
  };
}
```

**强制约束**：

- 主 Agent 下发的是 **goal + inputs + constraints**，而不是整段历史对话；
- 并行任务每个子任务独立一个 envelope；
- envelope 落盘到 `artifacts/{threadId}/{taskId}/input.json` 以备审计。

---

### 五、子→主：统一结果回传协议（SubTaskResult）

子 Agent 回传的结构必须稳定、可合并、可审计。

```ts
interface SubTaskResult<TData = unknown> {
  taskId: string;
  status: "success" | "failed" | "partial";

  summary: string;                 // <= 10 行，便于主 Agent 汇总
  data?: TData;                    // 严格按 expectedOutputSchema 返回

  artifacts?: Array<{
    id: string;
    type: string;                  // dataset / table / report / form / ...
    path: string;
    description?: string;
  }>;

  debug?: {
    usedSkills?: string[];
    usedTools?: string[];
    timingsMs?: Record<string, number>;
    warnings?: string[];
  };
}
```

**强制约束**：

- 子 Agent 不回传其内部完整思维链与大段中间文本；
- 大结果必须走 artifacts；
- 主 Agent 只消费 `summary + data + artifacts refs`。

---

### 六、主 Agent State 的统一结构（建议）

主 Agent（Orchestrator）State 建议只存“索引与汇总”，不存大数据：

```ts
interface OrchestratorState {
  input: {
    userInput: string;
    userId?: string;
    channel?: string;
    env: EnvConfig;
  };

  plan?: Array<{ stepId: string; agentType: string; goal: string }>;
  currentStepId?: string;

  resultsIndex?: Record<
    string,
    {
      status: "success" | "failed" | "partial";
      summary: string;
      artifacts?: Array<{ id: string; path: string; type: string }>;
    }
  >;

  lastDataSetRef?: { id: string; path: string };

  finalAnswer?: unknown;
}
```

说明：

- `resultsIndex` 中的 key 可以是 `taskId` 或 `stepId`；
- `lastDataSetRef` 指向最近一次可复用的数据集 artifact；
- 主 Agent 需要时从文件系统读取 artifact，避免把大数据塞进 State。

---

### 七、并行/串行协作规则（调度策略）

#### 7.1 串行（有依赖）

例如「先查 6 月 GMV，再分析与 5 月差异」：

1. Orchestrator 下发 DataQuery 子任务 → 得到 dataset artifact；
2. Orchestrator 将 dataset 的 `artifactRef` 写入 `lastDataSetRef`；
3. Orchestrator 下发 DataAnalysis 子任务，inputs 中引用 `lastDataSetRef`；
4. 汇总输出。

#### 7.2 并行（无依赖）

例如「同时查 GMV 和订单量」：

- Orchestrator 生成两个 `taskId`，并行下发两个 DataQuery 子任务；
- 结果分别落盘，主 Agent 只汇总两个 summary 与 artifactRef。

---

### 八、thread_id 与 checkpointer（与上下文协作的关系）

- `thread_id` 放在 **图调用 config** 的 `configurable.thread_id` 中；
- 同一 `thread_id` 的多次调用共享 checkpoint，可实现长任务/多轮对话；
- file-based artifacts 与 checkpoint 结合，可实现：
  - checkpoint 保存“进度与索引”；
  - 文件系统保存“大结果与审计证据”。

---

### 九、与 A1 / A2 的落地映射（必须遵守）

- A1：DataQueryAgent 的 `DataQueryResult` 直接作为 `SubTaskResult.data` 返回；当结果变大时，必须改为写入 artifacts 并仅回传引用。
- A2：DataAnalysisAgent 输入通过 `refs` 引用上一步 `lastDataSetRef`，避免把整份数据集塞进 prompt/state。

本规范为后续阶段（A3 智能表单、A4 DeepAgent 技能检索与记忆系统）提供统一的上下文协作基线。

