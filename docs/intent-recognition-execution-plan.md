# 意图识别与多轮澄清 — 实施执行文档

> **地位**：后续意图识别、主图路由、多轮追问相关开发**以本文档为执行依据**（排期、PR 拆分、验收）。  
> **背景与原理**：`docs/design-intent-recognition.md`（含 §11 问数域主题树与槽位协议）。  
> **第二期扩展**（SkillGuide 分布式槽位、多候选、执行前确认）：`docs/design-skillguide-distributed-slots.md`。  
> **协作约束**：`docs/context-collaboration-spec.md`（大结果走 artifacts，State 只存索引；`thread_id` 放在 `invoke` 的 `config.configurable`，不在 input 根上替代约定）。

---

## 一、目标摘要

1. 用 **LLM 结构化输出**（+ 规则兜底）替代主图仅靠关键词的意图判断。
2. **`needsClarification === true` 时不执行数据查询**：主图条件路由直达 `compose_answer`，**禁止**进入 `execute_data_query`。
3. **多轮**：同一 `thread_id` 下通过 **checkpointer** 合并 `OrchestratorState`，并维护可追加的 **对话轮次**（或等价结构）。
4. **第二期**：`resolvedSlots` 与 `DataQueryInput` / 子图对齐；问数域「槽位齐再查」与 §11、`design-skillguide-distributed-slots.md` 对齐。

---

## 二、职责边界（必须遵守）

| 层级 | 职责 |
|------|------|
| **主图（Orchestrator）** | 顶层意图、澄清、多轮状态、`finalAnswer` 分型；条件边决定是否调用 DataQuery。 |
| **DataQuery 子图** | 仅在「可执行」前提下消费 **结构化输入**（第二期以 `resolvedSlots` / `targetIntent` / `guideId` 等为主）；**不负责**会话级「是否闲聊、是否先追问」的主策略。 |
| **executeDataQueryNode** | 除路由外增加 **守卫**：澄清中或槽位不足时 **不得**调用 `runDataQueryAgent`。 |

---

## 三、开放决策（实施前锁定）

以下选项在首 PR 前由负责人定稿，并在类型与 `compose_answer` 中一致实现：

1. **对话存储**：第一期采用 **`conversationTurns` 截断**（如最近 10 轮）；会话摘要延后。
2. **`finalAnswer` 澄清形态**：建议 `{ type: "clarification", message: string }`，便于企微等渠道直接下发一句追问。
3. **意图枚举扩展**：统一用 `needsClarification` + `primaryIntent`，或单独增加 `out_of_scope` 等——二选一，避免与 `highLevelDomain` 冲突。
4. **`highLevelDomain` 与 `intentResult.primaryIntent`**：必须在 **意图节点内同一处** 写入映射（例如 `data_query` ↔ `primaryIntent === "data_query"`），禁止两路独立推断。

---

## 四、当前基线（对照用）

| 位置 | 现状 |
|------|------|
| `src/agents/intentAgent.ts` | 关键词判断 `data_query` / `other`，无 LLM |
| `src/graph/orchestrator/orchestratorGraph.ts` | 线性：`intent` → `execute_data_query` → `compose`，无条件边 |
| `src/contracts/schemas.ts` | `OrchestratorState` 无 `conversationTurns` / `intentResult` / `intentPhase` |
| `runOrchestratorGraph` | 单次 `invoke({ input })`，无历史合并 |
| `orchestratorApp.compile()` | **未**挂 checkpointer |

---

## 五、建议类型契约（里程碑 1）

### 5.1 `IntentResult`（`src/contracts/types.ts` + Zod）

建议字段（可与 `design-intent-recognition.md` 微调，但改字段须同步本文档）：

- `primaryIntent`: `"data_query" | "chitchat" | "unknown"`（或团队定稿枚举）
- `needsClarification`: `boolean`
- `clarificationQuestion?`: `string`
- `resolvedSlots?`: `Record<string, unknown>`（第一期可占位 `{}`）
- `confidence?`: `number`
- 问数域对齐 §11 时：可增加 `targetIntent?`、`missing_slots?` 等与 JSON 协议一致字段（见设计文档 §11）

### 5.2 `OrchestratorState` 扩展（`src/contracts/schemas.ts` + 手写 `OrchestratorState`）

- `conversationTurns?`: `Array<{ role: "user" | "assistant"; content: string }>`，需配置 **append reducer**（与所用 `@langchain/langgraph` 版本 API 一致）。
- `intentResult?`: 与 `IntentResultSchema` 一致。
- `intentPhase?`: `"classify" | "awaiting_clarification" | "ready"`（可选；若完全由 `intentResult` 推导可省略，但须在代码中统一约定）。

### 5.3 `OrchestratorInput`（可选扩展）

若不在 state 中合并「仅本轮输入」，可通过 `OrchestratorInput` 增加 `conversationTurnsPatch` 等字段由入口写入；**推荐**以 state reducer 为主，避免双通道。

---

## 六、主图路由真值表（里程碑 3）

`intent_agent` 之后的条件边逻辑（伪代码级，实现时以 state 为准）：

| 条件 | 下一节点 |
|------|----------|
| `intentResult?.needsClarification === true` | `compose_answer` → `END` |
| `primaryIntent === "data_query"` 且非澄清 | `execute_data_query` → `compose_answer` → `END` |
| 其他 | `compose_answer` → `END` |

**硬约束**：`execute_data_query` 入口守卫与上表一致，防止回归。

---

## 七、里程碑与文件清单

### 里程碑 0：多轮基础设施（必须先做）

| 动作 | 文件 / 位置 |
|------|----------------|
| 接入 checkpointer | `src/graph/orchestrator/orchestratorGraph.ts`：`compile({ checkpointer })`，使用 `@langchain/langgraph-checkpoint` 的 `MemorySaver` 或可配置持久化实现 |
| 全链路传入 `thread_id` | 所有 `invoke` 调用处：`config.configurable.thread_id` |
| 对话写入策略 | `runOrchestratorGraph`（同文件或独立 runner）、`src/channels/wecom/*.ts`：每轮追加 user（及可选 assistant）到 `conversationTurns` |

**验收**：同一 `thread_id` 连续两次 `invoke`，第二次节点能读到第一次写入的 state 字段（含 `conversationTurns`）。

---

### 里程碑 1：State 与类型

| 动作 | 文件 |
|------|------|
| 定义 `IntentResult` 与 Zod | `src/contracts/types.ts`、`src/contracts/schemas.ts`（或集中 Zod 文件，与仓库风格一致） |
| 扩展 `OrchestratorStateSchema` 与 `OrchestratorState` | `src/contracts/schemas.ts` |
| 为 `conversationTurns` 配置 reducer | `OrchestratorStateSchema` 字段定义 |

**验收**：TypeScript 编译通过；单测或最小脚本可序列化/反序列化 `intentResult`。

---

### 里程碑 2：意图节点（LLM + 兜底）

| 动作 | 文件 |
|------|------|
| 实现分类 Agent | 新建 `src/agents/intentClassifyAgent.ts` 或重构 `src/agents/intentAgent.ts` |
| 调用 Chat 模型 | 使用 `@langchain/openai` + 现有 `env`（如 DashScope 兼容基址） |
| JSON 解析与校验 | `IntentResultSchema.safeParse`；失败则回退当前关键词逻辑 |
| 节点装配 | `src/graph/orchestrator/intentAgentNode.ts`：写回 `intentResult`、`highLevelDomain`、`intentPhase` |

**验收**：固定 prompt 样例下解析成功；非法 JSON 走兜底，主图不崩溃。

---

### 里程碑 3：主图条件路由与合成

| 动作 | 文件 |
|------|------|
| 条件边 | `src/graph/orchestrator/orchestratorGraph.ts`：`addConditionalEdges("intent_agent", ...)` |
| 执行守卫 | `src/graph/orchestrator/executeDataQueryNode.ts`：澄清中 / 非 ready / 槽位不足则不调用 `runDataQueryAgent` |
| 输出分型 | `src/graph/orchestrator/composeAnswerNode.ts`：`clarification` / `data_query` / `chitchat` / `fallback` |

**验收**：模拟 `needsClarification: true` 时，**无** `resultsIndex` 更新、**无** DataQuery 子图调用（可通过 mock 或日志断言）。

---

### 里程碑 4：渠道与 CLI

| 动作 | 文件 |
|------|------|
| 企微 | `src/channels/wecom/*.ts`：合并短历史进 state / input |
| CLI 自测 | `src/index.ts` 或单独脚本：同 `thread_id` 多轮输入 |

**验收**：企微或 CLI 至少一条路径完成「澄清 → 用户补充 → 查数」闭环。

---

### 里程碑 5（第二期）：槽位与 DataQuery 对齐

| 动作 | 文件 |
|------|------|
| 扩展 `DataQueryInput` | `src/contracts/schemas.ts`、`types.ts` |
| `SubTaskEnvelope.inputs` 携带槽位与目标意图 | `src/graph/orchestrator/executeDataQueryNode.ts` |
| 子图消费结构化字段 | `src/graph/data-query/dataQueryGraph.ts`：关键词仅兜底 |
| 澄清轮数上限、超时策略 | 主图意图节点或独立策略模块（与设计文档一致） |

**验收**：缺必填槽位时主图只返回澄清，不执行 SQL；槽位齐全时子图不再依赖纯关键词猜意图。

---

### 里程碑 6（第二期，可选）：SkillGuide 分布式槽位

严格按 `docs/design-skillguide-distributed-slots.md` 实施：**`src/guides/*` 解析与校验**、**`select_guide` 类节点**、**多候选 / `pendingConfirmation`**、主图条件边扩展、与 `sql-query` 模板化安全策略。

本文档不重复该文细节；里程碑 6 完成时应在 PR 中引用该设计文档章节。

---

## 八、测试与观测

| 类型 | 内容 |
|------|------|
| 单元 | Zod 校验、规则兜底、（第二期）`slotValidation` |
| 集成 | 同 `thread_id` 多轮；澄清轮不触发 DataQuery |
| 日志 / 调试 | `intentResult`、`thread_id`、是否进入 `execute_data_query`（勿记录完整用户隐私明文到公共日志） |

---

## 九、修订记录

| 日期 | 说明 |
|------|------|
| 2026-03-28 | 初稿：从设计文档与代码基线整理为可执行清单 |

---

**执行顺序**：里程碑 **0 → 1 → 2 → 3** 为第一期闭环；**4** 与渠道并行；**5 → 6** 为第二期，依赖 §11 与 SkillGuide 约定定稿。
