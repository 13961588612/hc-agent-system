# 意图识别子计划（多轮澄清 + LLM）

本文档为**独立子计划**，与阶段一最小闭环（`docs/design-phase1-minimal-loop.md`）并行演进：在不大改主↔子协议（`SubTaskEnvelope` / `SubTaskResult`）的前提下，提升**意图识别**与**多轮澄清**能力，并将结论与 checkpoint 中的 `OrchestratorState` 对齐。

**上下文协作规范**：仍遵守 `docs/context-collaboration-spec.md`（大结果走 artifacts，State 只存索引）。

---

## 一、目标

1. **意图**：用模型（+ 可选规则兜底）替代纯关键词，区分「数据查询 / 闲聊 / 未明确」等。
2. **多轮**：利用 **checkpoint + 扩展 state**，支持指代（如「再查一遍」）、**缺参澄清**（澄清完成前不执行数据查询）。
3. **架构**：主图仍走 `OrchestratorState`；DataQuery 子图仅在「意图已就绪」时执行。

**问数域**（会员 / 店铺等主题树、槽位、识别 JSON、多轮合并）的详细设计见 **§十一**。

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
| 问数域详细设计 | 增加 §11：主题树编码、槽位、JSON 协议、分层识别、多轮合并、澄清模板与评测 |

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

---

## 十一、问数域：查询主题与意图识别详细设计

本节将「问数」能力细化为**可编码的主题树 + 槽位 + 识别输出协议**，目标对齐：**该问的时候追问，槽位齐了再查**；与知识问答、智能做单通过顶层域区分，便于后续扩展。

### 11.1 设计目标

1. 先识别**查什么主题**（落到**叶子意图**，如 `member.points`）。
2. 再判断**能否直接查**：缺必填槽位 → 只输出澄清与 `missing_slots`，**不执行查询**。
3. 槽位齐备 → 标记可执行，下游 DataQuery / SQL 技能**只消费结构化槽位**，避免从整句自然语言直接猜 SQL。
4. 多轮：在**同一 `thread_id`** 下合并槽位（会话状态或 checkpoint），支持改条件、指代、换对象。

### 11.2 意图层级（稳定编码）

使用点号分层，便于日志、配置与路由。

| 编码 | 名称 | 说明 |
|------|------|------|
| `member` | 会员（单人） | 一般需先绑定会员标识 |
| `member.profile` | 会员个人档案 | 档案类字段 |
| `member.points` | 会员积分情况 | 流水/余额等 |
| `member.coupons` | 会员券情况 | 券列表/状态 |
| `member.orders` | 会员订单情况 | 订单列表 |
| `store` | 店铺 | 一般需先绑定店铺 |
| `store.sales_summary` | 时段店铺销售汇总 | 时间 + 店铺 |
| `store.basic` | 店铺基本情况 | 人员/合同/地块等；可用 `aspect` 再分子类 |

**扩展**：若需先粗后细，可在 `store.basic` 下增加 `aspect` 取值，如 `people` / `contract` / `land`（或后续再拆 `store.basic.hr` 等叶子）。

### 11.3 槽位（Slots）定义

**公共槽位**（可组合使用）：

| 槽位 | 含义 | 典型用途 |
|------|------|----------|
| `member_ref` | 会员标识（手机号/会员号/姓名等，解析后为内部 ID） | `member.*` |
| `store_ref` | 店铺标识（店名/编码） | `store.*` |
| `time_range` | 时间范围（起止日期或「近 7 天」「本月」解析结果） | `store.sales_summary`、部分带时间过滤的 `member.*` |
| `aspect` | 细分子类 | `store.basic` 下：人员/合同/地块 |

### 11.4 叶子意图：执行查询前的必填条件

| 叶子意图 | 执行前**必填** | 常见**可选** |
|----------|----------------|--------------|
| `member.profile` | `member_ref` | — |
| `member.points` | `member_ref` | `time_range`（若产品默认「最近 N 条」则可不填） |
| `member.coupons` | `member_ref` | 券状态等筛选 |
| `member.orders` | `member_ref` | `time_range`、订单状态 |
| `store.sales_summary` | `store_ref` + `time_range` | 粒度（日/周）、对比维度 |
| `store.basic` | `store_ref` | `aspect`；若未指定可**先追问**或一次返回多板块摘要（产品二选一） |

**规则**：`missing_slots` 非空 → `needs_clarification === true` → **不进入** SQL 执行节点。

### 11.5 意图识别输出协议（建议 JSON）

供 LLM 输出 + Zod 校验，并与编排路由一致：

```json
{
  "primary_domain": "member | store | other",
  "target_intent": "member.points | store.sales_summary | ...",
  "confidence": 0.0,
  "slots": {
    "member_ref": "...",
    "store_ref": "...",
    "time_range": { "start": "...", "end": "..." },
    "aspect": "people | contract | land | null"
  },
  "missing_slots": ["member_ref"],
  "needs_clarification": true,
  "clarification_question": "请问要查询哪位会员？可提供手机号或会员号。",
  "reason_short": "用户未指定会员"
}
```

**路由约定**：

- `needs_clarification === true` → 仅生成用户可见回复（追问），**不**调用 DataQuery 执行。
- `needs_clarification === false` 且 `target_intent` 属于上表叶子 → 携带 `slots` 进入问数子图 / 技能。

与全局能力的关系：`primary_domain === "member" | "store"` 时可映射为编排层的 `highLevelDomain === "data_query"`，并用 `target_intent` 做子路由；知识问答、智能做单使用其它 `primary_domain` 或顶层枚举（见里程碑扩展）。

### 11.6 分层识别策略（工程推荐）

1. **第一层**：`primary_domain`（member / store / other）。可用关键词 + 轻规则辅助（如「会员、积分、券、订单」→ member；「店铺、销售」→ store）。
2. **第二层**：在 domain 内区分**叶子意图**（如 `member.points` vs `member.orders`），用语义与词典。
3. **第三层**：**槽位抽取**（`member_ref`、`store_ref`、`time_range` 等）。
4. **第四层**：按 11.4 做**必填校验**，生成 `missing_slots` 与 `clarification_question`（可模板化）。

低置信或 JSON 解析失败时，**规则兜底**（关键词 + 默认追问），避免链路全断。

### 11.7 多轮槽位合并（与主题强相关）

| 场景 | 行为 |
|------|------|
| 已填 `member_ref`，用户说「再看积分」 | 继承 `member_ref`，`target_intent` → `member.points` |
| 已查某会员，用户说「换 138xxxx 查」 | 更新 `member_ref`，意图可按上轮或再问 |
| `store.sales_summary` 已选店，用户说「改成上周」 | 主要更新 `time_range` |
| 只说「店铺销售」未指定哪家店 | `missing_slots: ["store_ref"]` |

**实现要点**：意图识别每次输入除本轮 `userInput` 外，应包含 **state 中已确认 slots**（及可选 `conversationTurns`），模型做**增量填充**，而非每轮从零推断。

### 11.8 与编排 / DataQuery 的衔接

- **Orchestrator**：根据 `needs_clarification` 分支；将 `target_intent` + `slots` 写入 state，供子图消费。
- **DataQuery / sql-query**：入参由 `target_intent` + `slots` 映射到「域路由 + SQL 模板或技能」，**不**直接从整句用户话猜 SQL。
- **知识问答、智能做单**：通过 `primary_domain` / 顶层意图与问数域区分，子图独立扩展。

### 11.9 缺槽澄清话术模板（可直接配置或拼进 Prompt）

| 缺槽 | 模板示例 |
|------|----------|
| `member_ref` | 请问要查询哪位会员？可提供手机号或会员号。 |
| `store_ref` | 请问要查询哪家店铺？可提供店铺名称或编码。 |
| `time_range` | 请问统计哪段时间？例如「本月」「上周」或起止日期。 |
| `aspect`（`store.basic`） | 您需要了解店铺的哪方面：人员、合同还是地块？ |

可按业务再细化（权限提示、默认时间口径等）。

### 11.10 评测建议

为每个**叶子意图**准备多条真实说法，覆盖：一次说满槽位；只问域不问对象；多轮补槽；易混对（如积分 vs 订单、销售汇总 vs 店铺概况）。

除**意图准确率**外，重点看：**缺槽时是否误执行查询**（比单纯分类准确率更能反映「该问则问、该查则查」）。

### 11.11 SkillGuide 分布式槽位（置信度 / 多候选 / 确认）

将「每模板参数契约」放在各 Guide 的 frontmatter（`params`、`execution`），与 **置信度、多候选澄清、执行前用户确认** 的编排与类型修改，见 **`docs/design-skillguide-distributed-slots.md`**（含文件级修改清单与实施顺序）。
