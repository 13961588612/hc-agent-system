# 意图识别子计划（多轮澄清 + LLM）

本文档为**独立子计划**，与阶段一最小闭环（`docs/design-phase1-minimal-loop.md`）并行演进：在不大改主↔子协议（`SubTaskEnvelope` / `SubTaskResult`）的前提下，提升**意图识别**与**多轮澄清**能力，并将结论与 checkpoint 中的 `OrchestratorState` 对齐。

**上下文协作规范**：仍遵守 `docs/context-collaboration-spec.md`（大结果走 artifacts，State 只存索引）。

---

## 一、目标

1. **意图**：用模型（+ 可选规则兜底）替代纯关键词，区分「数据查询 / 闲聊 / 未明确」等。
2. **多轮**：利用 **checkpoint + 扩展 state**，支持指代（如「再查一遍」）、**缺参澄清**（澄清完成前不执行数据查询）。
3. **架构**：主图仍走 `OrchestratorState`；DataQuery 子图仅在「意图已就绪」时执行。

---

## 二、现状与缺口

| 现状 | 缺口 |
|------|------|
| `intentAgent` 仅关键词 | 无语义理解、无语境 |
| 线性图：intent → execute → compose | 「需澄清」时无法短路到仅回复、不跑 SQL |
| state 无对话轮次 / 摘要 | 多轮指代无法利用 |
| `env` 已具备 DashScope 等能力 | 需在 intent 节点显式调用 LLM |

---

## 三、方案分阶段

### 第一期（最小可用）：结构化意图 + 条件分支 + 轻量多轮

**1）扩展 `OrchestratorState` / Zod（`src/contracts/schemas.ts`）**

- `intentPhase`: `"classify" | "awaiting_clarification" | "ready"`（或等价枚举）。
- `intentResult`（结构化，建议 Zod 校验），例如：
  - `primaryIntent`: `"data_query" | "chitchat" | "unknown"`
  - `needsClarification`: boolean
  - `clarificationQuestion?`: string（向用户追问的一句话）
  - `resolvedSlots?`: Record（时间、实体等；第一期可占位）
  - `confidence?`: number（可选）
- **可选其一**（第一期先实现简单方案）：
  - `conversationTurns`: `Array<{ role: "user"|"assistant"; content: string }>`（截断最近 N 条），或
  - `conversationSummary?: string`（后续再摘要压缩）

**2）新节点 / 改造节点**

- **`intent_agent`** 增强为 **`intent_classify`**（名称可保持节点名不变）：
  - 读 `input.userInput` + `conversationTurns`（或 summary），调用 LLM，输出 `intentResult`。
  - 若 `needsClarification`，设 `intentPhase = awaiting_clarification`，**不**将 `highLevelDomain` 置为 `data_query`。
- **规则兜底**：低置信或 JSON 解析失败时走关键词/规则，避免全链路失败。

**3）图结构（`src/graph/orchestrator/orchestratorGraph.ts`）**

- `START → intent_classify`
- **条件边**：
  - `needsClarification` → `compose_answer`（仅返回澄清问句）→ `END`
  - `data_query` 且已就绪 → `execute_data_query` → `compose_answer` → `END`
  - 其他/闲聊 → `compose_answer`（策略或轻量回复）→ `END`

**4）多轮与 checkpoint**

- 每轮 `invoke` 仍传入 `{ input: OrchestratorInput }`；**同一 `thread_id`** 下由 checkpoint 合并 state。
- **入口层**（`runOrchestratorGraph` 或渠道 handler）需将**本轮用户话**并入 `conversationTurns`（或更新 summary），否则多轮仍只有本轮一句。
- 第二轮用户补充「上周」等时，模型在 `intent_classify` 中应能看到上一轮 assistant 的澄清 + 本轮补充。

**5）LLM 调用**

- 使用已有 `env`（如 `dashscopeApiKey` + 兼容 OpenAI 的 Chat 接口）与 `@langchain/openai`。
- Prompt 要求输出 **严格 JSON**，与 `intentResult` 一致，经 Zod 校验；失败则回退规则。

**6）涉及文件（第一期清单）**

| 文件 | 动作 |
|------|------|
| `src/contracts/schemas.ts` | 扩展 `OrchestratorStateSchema` + 手写 `OrchestratorState` 对齐类型 |
| `src/contracts/types.ts` | 新增 `IntentResult` 等（若未全部放在 schema 中） |
| `src/agents/intentAgent.ts` | 改为 LLM + JSON 解析，或 `intentClassifyAgent.ts` |
| `src/graph/orchestrator/intentAgentNode.ts` | 对接新逻辑，写 state |
| `src/graph/orchestrator/orchestratorGraph.ts` | 条件边；必要时新节点 |
| `src/graph/orchestrator/composeAnswerNode.ts` | 分支：澄清 / 查询结果 / 其它 |
| `runOrchestratorGraph` 与渠道入口 | 合并 `conversationTurns` 的输入与 reducer 策略 |

### 第二期（增强）：槽位与 DataQuery 对齐

- `resolvedSlots` 与 `DataQueryInput` 对齐（域、意图、时间窗等）。
- `execute_data_query` 仅在 `intentPhase === "ready"` 且槽位足够时执行。
- 澄清轮数上限、超时回到 `unknown`。
- 可选：`conversationTurns` 改为「摘要 + 最近 k 条」控 token。

---

## 四、风险与约束

- **成本与延迟**：每轮多一次 LLM；可对明显意图做规则短路。
- **JSON 可靠**：Zod 校验 + 失败重试或降级规则。
- **执行安全**：条件边保证「澄清中」不进入 `execute_data_query`。

---

## 五、建议执行顺序

1. 定稿 `IntentResult` 与 state 字段（枚举与澄清策略）。
2. 改 `schemas.ts` + `runOrchestratorGraph` 对 `conversationTurns` 的合并策略。
3. 实现 `intent_classify` + LLM + JSON。
4. 改 `orchestratorGraph` 条件边 + `composeAnswerNode`。
5. 接 wecom / CLI 入口，追加对话轮次。
6. 多轮用例自测（澄清 → 补全 → 查数）。

---

## 六、与主文档索引关系

| 文档 | 关系 |
|------|------|
| `docs/design-phase1-minimal-loop.md` | 阶段一最小闭环；本计划在其上增强意图与澄清 |
| `docs/context-collaboration-spec.md` | 大结果、artifacts、State 索引 |
| `docs/channel-wecom.md` | 企微渠道与 `thread_id` |

---

## 七、修订记录

| 日期 | 说明 |
|------|------|
| （初稿） | 从「意图识别修改计划」讨论整理为仓库子计划文档 |
| 规划补充 | 多轮/追问实施里程碑、checkpoint 前置、与当前仓库对齐 |

---

## 八、实施规划（里程碑）

以下为**建议迭代顺序**，便于评审与排期；每步可单独 PR。

### 里程碑 0：多轮基础设施（必须先做）

| 项 | 说明 |
|----|------|
| **Checkpoint** | 当前 `orchestratorApp.compile()` **未挂 checkpointer**，同 `thread_id` 多次 `invoke` **不会**自动合并历史 state。需接入 `@langchain/langgraph-checkpoint` 的 `MemorySaver`（或持久化 checkpointer），并在 `compile({ checkpointer })` 与 `invoke(..., { configurable: { thread_id } })` 上打通。 |
| **对话轮次写入** | 在 `runOrchestratorGraph` 或渠道入口：除 `input.userInput` 外，将「本轮用户话」与（可选）上一轮 `finalAnswer` 以 **`conversationTurns` 追加** 形式写入；或使用 LangGraph **reducer**（`messages`/`conversationTurns` 的 append 策略）。无此步则「追问」无上下文。 |

### 里程碑 1：State 与类型（契约）

1. 在 `OrchestratorStateSchema` / 手写 `OrchestratorState` 中增加：  
   - `conversationTurns?: Array<{ role: "user" \| "assistant"; content: string }>`（或 `messages` 与 LangChain 约定对齐）  
   - `intentResult?: IntentResult`（Zod：`IntentResultSchema`）  
   - `intentPhase?: "classify" \| "awaiting_clarification" \| "ready"`（可选，也可用 `intentResult.needsClarification` 推导）  
2. 在 `contracts/types.ts` 导出 `IntentResult` 类型，与 Zod 一致。  
3. **`highLevelDomain` 与 `intentResult.primaryIntent` 映射**：约定 `data_query` ↔ `primaryIntent === "data_query"`，避免两套路由打架。

### 里程碑 2：意图节点（LLM + 兜底）

1. 新增 `src/agents/intentClassifyAgent.ts`（或重构 `intentAgent.ts`）：  
   - 输入：`userInput`、`conversationTurns` 截断（如最近 10 轮）、可选 `env`。  
   - 调用：`ChatOpenAI` + DashScope 兼容基址（与现有 `env` 一致）。  
   - 输出：JSON → `IntentResultSchema.safeParse`；失败则 **关键词兜底**（沿用当前 `runIntentAgent` 逻辑）。  
2. `intentAgentNode` 仅负责组装 prompt、调用 agent、写回 `state.intentResult` / `highLevelDomain` / `intentPhase`。

### 里程碑 3：主图条件路由

1. `orchestratorGraph.ts`：`addConditionalEdges("intent_agent", routeFn, { ... })`：  
   - `needsClarification` → `compose_answer` → `END`  
   - `primaryIntent === "data_query"` 且非澄清 → `execute_data_query` → `compose_answer` → `END`  
   - 其他 → `compose_answer` → `END`  
2. `executeDataQueryNode`：增加守卫——若 `intentResult?.needsClarification` 或槽位不足，**不执行**（或由路由保证永不进入）。  
3. `composeAnswerNode`：根据 `finalAnswer` 类型区分：`clarification` \| `data_query` \| `chitchat` \| `fallback`。

### 里程碑 4：渠道与 CLI

1. **企微长连接 / HTTP**：在调用 `runOrchestratorGraph` 前，从会话拉取或本地维护**短历史**，填入 `conversationTurns` 或合并进 `input`（二选一，与里程碑 0 一致）。  
2. **CLI**：可选交互循环，同 `thread_id` 多轮输入，验证 checkpoint + 意图 + 澄清链路。

### 里程碑 5（第二期）：槽位与 DataQuery 对齐

- `resolvedSlots` 映射到 `DataQueryInput` / 子图路由；澄清轮数上限；`conversationSummary` 降 token。

---

## 九、与当前仓库对齐（基线）

| 位置 | 现状 |
|------|------|
| `src/agents/intentAgent.ts` | 关键词 `data_query` / `other`，无 LLM |
| `src/graph/orchestrator/orchestratorGraph.ts` | 线性 3 边，无条件分支 |
| `src/contracts/schemas.ts` | 无 `conversationTurns` / `intentResult` |
| `runOrchestratorGraph` | 单次 `invoke({ input })`，无历史合并 |
| Checkpoint | **未接入**编译时 checkpointer |

以上任一项未满足时，「多轮追问意图」只能部分实现（例如仅 LLM 单轮分类，无跨轮 state）。

---

## 十、开放决策（落地前确认）

1. **对话存 state 还是只存摘要**：第一期建议 **turns 截断**；摘要延后。  
2. **澄清是否占用独立 `finalAnswer` 类型**：建议 `{ type: "clarification", message: string }`，便于渠道只发一句追问。  
3. **意图枚举**：是否单独增加 `clarify_only` / `out_of_scope`，或统一用 `needsClarification` + `primaryIntent`。
