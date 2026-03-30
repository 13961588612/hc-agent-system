# 里程碑 6：SkillGuide 分布式槽位与可执行检索 — 详细设计

> **地位**：`docs/intent-recognition-execution-plan.md` **里程碑 6** 的独立详细设计；实施时以本文与 `docs/design-skillguide-distributed-slots.md` 为据，后者偏「概念与清单」，本文偏「契约、状态机与落地顺序」。  
> **前置**：里程碑 0～5 已具备（含 `IntentResult`、`resolvedSlots`、`checkpoint`、`conversationTurns`、澄清轮数/超时策略）。  
> **协作约束**：`docs/context-collaboration-spec.md`（大结果走 artifacts，State 只存索引）。

---

## 一、目标与边界

### 1.1 目标（必须达成）

| 编号 | 目标 | 说明 |
|------|------|------|
| G0 | **独立 `guide_agent` 节点** | Guide 召回、填槽、校验、消歧/确认决策均在 **单独节点**（及可单测的 `runGuideAgent`）中完成，**不**并入 `intent_agent`，见 §六。 |
| G1 | **分布式槽位** | 每条 SkillGuide 在元数据中声明本模板所需的 `required` / `optional` 参数，**不**维护全局唯一槽位大表。 |
| G2 | **可自动校验** | 给定「当前选中的 Guide + 已解析参数表」，可判定 `satisfied` / `missing` / `invalid`。 |
| G3 | **Guide 召回与置信度** | 根据用户话与上下文产出候选 Guide 列表及分数，驱动后续分支。 |
| G4 | **多候选澄清** | Top-K 接近时，以结构化方式让用户消歧（编号/关键词），而非静默猜一条。 |
| G5 | **执行前确认（可选）** | 对高风险或配置要求项，执行 SQL 前展示「模板摘要 + 关键参数」，用户确认后再执行。 |
| G6 | **模板化 SQL 优先** | 执行路径以 **模板 + 参数绑定** 为主，与 `sql-query` 能力对齐；降低「任意长 SQL」的默认暴露面。 |

### 1.2 非目标（本里程碑不做或仅预留）

- 不接真实向量库也可先落地（召回先用 **tags + 关键词 + domain**）；向量检索作为**后续增强**。
- 不实现完整 BI/可视化；结果形态仍以 `DataQueryResult` + artifacts 为主。
- 不在此里程碑替换企微 SDK；仅约定 **确认/消歧** 的 `finalAnswer` 形态与渠道展示约定。

### 1.3 与现有系统的关系

- **主图**：在现有 `intent_agent` 之后 **插入独立 `guide_agent`**，再经条件边到 `execute_data_query` / `compose_answer`（边具体形态见 §六），而非推翻里程碑 5 的意图与澄清能力。
- **意图**：`intent_agent` 只负责粗粒度 `IntentResult`（域 / 是否问数 / 澄清等）；**选 Guide、槽位与 Guide 契约对齐、消歧与执行前决策** 全部由 **`guide_agent`** 完成，二者 State 通过 `OrchestratorState` 传递。
- **DataQuery**：`DataQueryInput` 增加「来自 Guide 的执行说明」（`guideId`、`boundParams`、`templateRef` 等），子图优先走 **模板执行路径**；无模板时行为见 §八「兼容策略」。

---

## 二、概念模型

### 2.1 实体

- **SkillGuideEntry**：扫描后的 Guide 记录（现有 `id`、`title`、`domain`、`tags`、`body`）+ **扩展字段**（`queryTemplateId`、`params`、`execution`）。
- **Guide 候选**：`{ guideId, score, reasons? }`，用于召回与消歧。
- **参数包**：Guide 层使用 `guideResolvedParams`（与 `Guide.params` 对齐）；意图粗槽位在 `intentResult.resolvedSlots`；**执行前合并**见 §7.1。
- **执行意图**：在参数齐 + 策略允许时，生成 **可审计** 的 `SqlInvocationPlan`（模板 id、绑定参数、purpose），再调 `sql-query`。

### 2.2 置信度与分支（逻辑真值表）

以下用「策略模块输出」抽象表示（实现可为单服务或多函数）。

| 条件 | 主图行为 |
|------|----------|
| 无候选或全局低于 `minRetrievalScore` | `compose`：通用追问或 `fallback`；**不执行** SQL |
| 单候选且 `score >= execution.minConfidence` 且槽位齐 | 若需确认且未确认 → `awaiting_confirmation`；否则 → **可执行** |
| 单候选但槽位不齐 | `clarification`（或沿用现有 clarification 形态 + `missingSlots`） |
| 多候选且 Top1 与 Top2 分差 `< ambiguityDelta` | `disambiguation`：列出选项 |
| 多候选但唯一高分 | 同单候选 |

（阈值名可配置：`GUIDE_RETRIEVAL_TOP_K`、`GUIDE_CONFIDENCE_AMBIGUITY_DELTA`、`GLOBAL_MIN_RETRIEVAL_SCORE`。）

---

## 三、SkillGuide 元数据扩展（frontmatter）

**修改面**：`skills/guides/**/*.md` 示例；`src/guides/types.ts`；`src/guides/scanGuides.ts` 解析与校验。

建议字段（与 `design-skillguide-distributed-slots.md` §二 对齐，可在此轮评审后定稿命名）：

```yaml
# 与现有 id / kind / title / domain / segment / relatedSkillIds / tags 并存

queryTemplateId: member.profile   # 可选；与意图 §11 / targetIntent 映射时可统一

params:
  required:
    - name: member_id
      type: string
      description: 会员业务主键或查询键
  optional:
    - name: time_range
      type: object
      description: 时间范围

execution:
  skillId: sql-query
  sqlTemplateRef: inline          # inline | path:...
  confirmBeforeRun: false         # 是否必须先用户确认再执行
  minConfidence: 0.72             # 低于则仅追问，不进入执行
```

**正文约定**：可用 fenced 代码块语言标签 **`sql-template`** 承载模板 SQL，占位符命名与 `params.name` 一致；具体占位符语法（`:name` / `?`）与 `sql-query` 参数顺序须在实现时 **锁死一种**。

**兼容**：未写 `params` / `execution` 的 Guide **行为与现网一致**（仅披露说明，不参与自动执行链路）。

---

## 四、类型与注册表（代码契约）

| 位置 | 内容 |
|------|------|
| `src/guides/types.ts` | 扩展 `SkillGuideMeta`：`queryTemplateId?`、`params?`（required/optional 条目数组）、`execution?`（skillId、sqlTemplateRef、confirmBeforeRun、minConfidence）。 |
| `src/guides/guideRegistry.ts` | `getGuide(id)`；可选 `listByDomain` / `searchByTags`；建立 `queryTemplateId → guideId` 索引（若存在）。 |
| `src/contracts/schemas.ts` / `types.ts` | 扩展 `OrchestratorState`：`guidePhase?`、`activeGuideCandidates?`、`pendingConfirmation?`、`pendingDisambiguation?` 等（字段名以评审为准，见 §七）。 |
| `finalAnswer` 分型 | 新增：`disambiguation`、`awaiting_confirmation`（与现有 `clarification`、`data_query`、`fallback`、`chitchat` 并列）；结构在 §七给出草案。 |

---

## 五、模块划分（建议文件）

| 模块 | 职责 |
|------|------|
| `src/guides/guideRetrieval.ts` | 输入 `userInput`、可选 `domain`、对话摘要；输出候选列表 + 分数 + 原因。 |
| `src/guides/slotValidation.ts` | 输入 `SkillGuideEntry` + `Record<param, value>`；输出 `satisfied`、`missing[]`、`invalid[]`。 |
| `src/guides/sqlTemplateBind.ts`（名可调整） | 从 Guide 取模板字符串 + 参数包 → 生成 `{ sql, params }` 供 `sql-query`；校验占位符与必填集合一致。 |
| `src/graph/orchestrator/guideAgentNode.ts` | 装配 `runGuideAgent`：召回 → 填槽/校验 → 消歧与确认决策；写 `OrchestratorState` 中 Guide 相关字段。 |
| `src/channels/wecom/wecomReplyFormat.ts` | 将 `disambiguation` / `awaiting_confirmation` 格式化为渠道文本（列表、确认提示）。 |

---

## 六、主图状态机（逻辑）

### 6.1 节点级（**已定案：独立 `guide_agent`**）

主图采用 **独立 `guide_agent` 节点**（对应实现文件见 §五 `guideAgentNode.ts`），**不**将 Guide 逻辑塞进 `intent_agent`。

**线框（逻辑顺序）**：

`START` → `intent_agent`（输出 `IntentResult`）→ **`guide_agent`**（召回 + 填槽 + 校验 + 消歧/确认决策，写 `selectedGuideId` / `guidePhase` / `pending*` 等）→ **条件边** → `execute_data_query` 或 `compose_answer` → `END`。

**说明**：

- 若 `intent_agent` 判定非问数（如 `chitchat`），可 **短路** 不经 `guide_agent` 直达 `compose_answer`（条件边在 `orchestratorGraph.ts` 中实现，避免无效召回）。
- 曾讨论的「在 `intent_agent` 内函数级串 Guide」仅作历史备选，**本里程碑不采用**，以免单节点过重、日志与单测边界模糊。

### 6.2 条件边（与里程碑 5 扩展）

在现有「澄清 / 缺槽 / data_query」之上增加：

| 条件（抽象） | 下一节点 |
|--------------|----------|
| 需消歧 | `compose_answer`（`finalAnswer.type = disambiguation`） |
| 需确认且未确认 | `compose_answer`（`awaiting_confirmation`） |
| 参数齐且策略允许执行 | `execute_data_query` |
| 否则需追问 | `compose_answer`（`clarification`） |

### 6.3 用户回合解析

- **消歧回合**：用户回复「1」/「会员档案」等 → `guide_agent` 将 `selectedGuideId` 写入 state；后续填槽写入 **`guideResolvedParams`**（意图侧 `resolvedSlots` 仍只保留粗粒度，见 §7.1）。
- **确认回合**：用户回复「确认」「是」→ 置 `confirmed: true`（状态字段），再进入 `execute_data_query`。

（与企微快捷按钮/菜单的映射可作为渠道增强，不阻塞首版。）

### 6.4 `guide_agent` 详细执行算法说明

本节描述 **`runGuideAgent(state) → Partial<OrchestratorState>`** 的推荐逻辑，实现时可拆为多个纯函数以便单测。阈值名与 §九一致。

#### 6.4.1 入口与短路

| 条件 | 行为 |
|------|------|
| `intentResult` 缺失 | 不写 Guide 字段，**原样返回** `{}` 或仅 `guidePhase: "idle"`（由主图约定）。 |
| `primaryIntent !== "data_query"` | **不跑**召回与填槽；返回 `{}`，由后续 `compose_answer` 处理闲聊等。 |
| `needsClarification === true` 或 `missingSlots?.length`（意图层已判缺参） | 原则上 **仍可**进入 `guide_agent` 做「在已知域内选 Guide + 追问槽位」；若产品约定「先只问意图、不问 Guide」，则此处 **短路** 直接 `{}`。推荐：**先短路**，待用户补充后再进 `guide_agent`（减少无效召回）。 |
| `intentResult` 已满足「仅走里程碑 5、无 Guide」的路径 | 若未启用 Guide 功能或注册表为空，返回 `{}`。 |

**主图边**：从 `intent_agent` 到 `guide_agent` 的边应带条件 **仅当** `primaryIntent === "data_query"` 且 **未**被意图层直接判为「只澄清、不查库」时进入（与上表「先短路」策略一致）。

#### 6.4.2 输入（只读）

- `state.input.userInput`、`state.input.env`
- `state.conversationTurns`（最近 K 条，用于填槽与消歧）
- `state.intentResult`（含 `dataQueryDomain`、`targetIntent`、**粗粒度** `resolvedSlots`）
- `state.guideResolvedParams`（若已存在，多轮延续）
- `state` 内与 Guide 相关的持久字段：`selectedGuideId`、`pendingDisambiguation`、`pendingConfirmation`、`guidePhase` 等（多轮）

#### 6.4.3 主流程（有序步骤）

以下用 **步骤编号** 表示单次 `guide_agent` 调用内的顺序；**同一用户回合**内执行完毕。

1. **加载注册表**  
   `allGuides = listRegisteredGuides()`（或按 `dataQueryDomain` / `tags` 预过滤）。

2. **识别会话阶段**（与上一轮 assistant 输出对齐）  
   - 若 `pendingDisambiguation` 存在且用户输入可解析为 **选项 id / 序号** → 转 **步骤 8（消歧解析）**，成功后得到 `selectedGuideId`，清空 `pendingDisambiguation`。  
   - 若 `pendingConfirmation` 存在且用户输入为 **确认语义**（是/确认/OK）→ 转 **步骤 9（确认门）**，置 `guideReadyToExecute = true`，清空 `pendingConfirmation`。  
   - 若 `pendingConfirmation` 存在且用户 **拒绝或改口** → 清空确认态，从 **步骤 3** 重新召回或追问。  
   - 否则进入 **冷启动或继续填槽** 路径。

3. **召回 `retrieve(userInput, intentResult, allGuides)`**  
   - 输出：`candidates: Array<{ guideId, score, title? }>`，已按 `score` 降序，长度 ≤ `GUIDE_RETRIEVAL_TOP_K`。  
   - 实现：首版 **关键词命中 + tags + domain 匹配** 打分；可加权 `intentResult.targetIntent` 与 `queryTemplateId` 一致者。

4. **全局置信度门**  
   - 若 `candidates.length === 0` 或 `top1.score < GLOBAL_MIN_RETRIEVAL_SCORE`：  
     - 写 `guidePhase: "idle"`，**不**设 `selectedGuideId`；由后续路由走 `compose_answer` 返回 **通用 fallback 或 clarification**（与意图层配合）。  
     - **结束**本节点（返回部分 state）。

5. **多候选消歧门**  
   - 若 `candidates.length >= 2` 且 `top1.score - top2.score < GUIDE_CONFIDENCE_AMBIGUITY_DELTA`：  
     - 写 `pendingDisambiguation.options`（取 TopK 展示），`guidePhase: "awaiting_disambiguation"`，`selectedGuideId` 清空或保留候选列表。  
     - **结束**；主图下一跳 **`compose_answer`**，`finalAnswer.type = disambiguation`。  

6. **单候选（或消歧后已得唯一 `selectedGuideId`）**  
   - `guide = getGuide(selectedGuideId)`。  
   - **Guide 专用填槽** `fillGuideParams(guide, intentResult.resolvedSlots, userInput, conversationTurns, optional LLM extract)`：  
     - 产出 **`guideResolvedParams`**：`Record<string, unknown>`，键 **仅**与 `guide.params.required/optional` 的 `name` 对齐（与意图粗槽位分离）。  
     - `intentResult.resolvedSlots` 仅作 **粗粒度提示**（如领域、用户随口提到的实体），供 LLM/规则 **映射** 到 Guide 精参名，**不**要求与 Guide 键名一致。  
     - LLM 抽取为 **可选**子步骤：输入为「当前 Guide 的 params 定义 + 对话 + 粗槽位」，输出 JSON，失败则仅用语义规则/正则。

7. **槽位校验 `validateSlots(guide, guideResolvedParams)`**  
   - 若 `missing` 非空：写 `guidePhase: "awaiting_slot"`，可把 `missing` 映射进 `intentResult.missingSlots` 或单独 `guideMissingParams`（实现定稿）；**结束**；下一跳 **`compose_answer`** → `clarification`。  
   - 若有 `invalid`：同上或专用错误提示。  
   - 若 `satisfied`：**继续**。

8. **执行前确认门（若 `guide.execution.confirmBeforeRun === true`）**  
   - 若当前回合 **尚未**确认：写 `pendingConfirmation{ guideId, paramsSummary }`，`guidePhase: "awaiting_confirmation"`，**结束**；`compose_answer` → `awaiting_confirmation`。  
   - 若已确认（见步骤 2）：**继续**。

9. **就绪**  
   - 写 `guidePhase: "ready"`，`selectedGuideId`，**`guideResolvedParams`** 写入 state；**执行合并**见 §7.1 `mergeParamsForExecution`。  
   - 可选：`sqlPlan = bindTemplate(guide, mergeParamsForExecution(...))` 仅放在 **envelope / 下一节点输入**，大 SQL 不进 State 全文（见协作规范）。

#### 6.4.4 子算法：召回打分（首版启发式）

对每条 Guide \(g\) 计算分数，例如：

\[
score(g) = w_1 \cdot \text{tagOverlap}(userInput, g.tags) + w_2 \cdot \mathbf{1}[\text{domain}(g) = intentResult.dataQueryDomain] + w_3 \cdot \text{keywordHit}(userInput, g.title, g.body) + w_4 \cdot \mathbf{1}[g.queryTemplateId = intentResult.targetIntent]
\]

\(w_i\) 可配置；归一化到 \([0,1]\) 或保留相对序即可。**禁止**在同分处理中静默随机：同分时按 `guideId` 字典序或 **一律进消歧**（由产品选）。

#### 6.4.5 子算法：`validateSlots`

- 对 `guide.params.required` 中每个 `name`：若 `paramRecord[name]` 缺失或空字符串 → 加入 `missing`。  
- 若声明 `type`：可做轻量校验（如 `string` / `number`），失败入 `invalid`。  
- 返回 `{ satisfied, missing, invalid }`。

#### 6.4.6 子算法：消歧解析（用户回复 → `guideId`）

- 若输入为纯数字 `k` 且 `1 ≤ k ≤ options.length` → `selectedGuideId = options[k-1].guideId`。  
- 若输入与某 `option.label` / `guideId` **子串匹配**（大小写不敏感）→ 取该条。  
- 否则：**不匹配** → 保持 `pendingDisambiguation`，下一轮仍走 `compose_answer` 追问「请回复 1～n」或重新召回（策略可配置）。

#### 6.4.7 子算法：确认语义解析

- 正向：`/^(是|好的|确认|OK|ok|yes|Y)$/i` 等扩展。  
- 负向：取消/否 → 转步骤 3 或只清 `pendingConfirmation`。

#### 6.4.8 输出摘要

| guide_agent 结束态 | 主图下一跳（典型） | State 关键字段 |
|--------------------|-------------------|----------------|
| 无可靠候选 | `compose_answer` | `guidePhase: idle` |
| 待消歧 | `compose_answer` | `pendingDisambiguation` |
| 待填槽 | `compose_answer` | `missing` / `guidePhase: awaiting_slot` |
| 待确认 | `compose_answer` | `pendingConfirmation` |
| 就绪 | `execute_data_query` | `guidePhase: ready`, `selectedGuideId`, 绑定参数 |

**注意**：`compose_answer` 仍负责把上述状态 **翻译** 为 `finalAnswer` 各分型；`guide_agent` **不**直接生成对用户展示文案（除可选 debug），避免与渠道格式重复。

---

## 七、OrchestratorState 与 finalAnswer 草案

以下字段名为 **草案**，实施前需统一命名与 Zod 校验。

### 7.1 State 扩展（草案）

```text
guidePhase?: "idle" | "retrieving" | "awaiting_slot" | "awaiting_disambiguation" | "awaiting_confirmation" | "ready"

activeGuideCandidates?: Array<{ guideId: string; score: number; title?: string }>

selectedGuideId?: string

# 已定案 §7.1：Guide 专用精参（与 Guide.params 名称一致）；意图粗槽位仍在 intentResult.resolvedSlots
guideResolvedParams?: Record<string, unknown>

pendingConfirmation?: {
  guideId: string
  paramsSummary: string      # 给人看的摘要，不落库敏感明文可配置
  sqlPreviewHash?: string   # 可选：模板+参数哈希，防篡改
}

pendingDisambiguation?: {
  options: Array<{ guideId: string; label: string; hint?: string }>
  expiresAtMs?: number       # 可选：与澄清空闲策略结合
}
```

### 7.1.1 意图粗槽位 vs Guide 精参（**已定案：方案 1**）

| 字段 | 职责 | 谁写入 |
|------|------|--------|
| `intentResult.resolvedSlots` | **粗粒度**：域、随口实体、意图级键名（可与 Guide 不一致） | `intent_agent`（LLM/兜底） |
| `guideResolvedParams` | **Guide 契约内**精参：键名与当前 `selectedGuide` 的 `params.*.name` 一致 | `guide_agent`（填槽 / 校验通过后） |

**校验与绑定**：`slotValidation`、`sqlTemplateBind` **仅以 `guideResolvedParams`**（及选中的 Guide 定义）为准；意图粗槽位 **不**直接当 SQL 绑参，除非已映射进 `guideResolvedParams`。

### 7.1.2 执行前合并 `mergeParamsForExecution`

进入 `execute_data_query` 或构造 `DataQueryInput` 时，生成 **单次执行用** 参数包（不落盘全文敏感值时可脱敏）：

```text
merged = {
  ...intentResult.resolvedSlots,   // 粗粒度在先
  ...guideResolvedParams           // Guide 精参在后；同名键以 Guide 为准（覆盖意图层）
}
```

- **语义**：意图提供「背景与粗实体」，Guide 提供「模板可绑定的正式参数名」；冲突时 **Guide 优先**，避免意图 LLM 键名与模板占位符不一致导致误绑。  
- **可选**：若需禁止无意图键泄漏进 SQL，可改为 `merged = { ...guideResolvedParams }` 仅当 Guide 路径；里程碑 6 默认采用 **并集 + 覆盖** 以保持与里程碑 5 演示 SQL（如 `user_id`）兼容。

### 7.2 finalAnswer 分型（草案）

```ts
// 新增
{ type: "disambiguation"; options: Array<{ id: string; label: string; hint?: string }>; message?: string }

{ type: "awaiting_confirmation"; message: string; guideId: string; paramsSummary: string }

// 现有 clarification / data_query / fallback / chitchat 保持不变语义
```

渠道层：企微单条长度限制下，选项列表需 **编号 + 短标题**，详见 `wecomReplyFormat`。

---

## 八、执行层与 sql-query

### 8.1 模板化路径

- `executeDataQueryNode` 或子图入口：若存在 `selectedGuideId` + **`guideResolvedParams`**，则按 §7.1.2 得到 `merged` 再 **`bindTemplate(guide, merged)`** 构造 `DataQueryInput.sqlQuery`（或专用字段）调用 **`runSqlQuerySkill`**，**禁止**未经验证的裸 SQL 字符串（除非显式 `allowRawSql` 且仅运维环境）。

### 8.2 兼容策略

- **仅意图、无 Guide**：保持现有「结构化 `targetIntent` + 演示 SQL」或关键词路径（里程碑 5）。
- **有 Guide 但未配置模板**：不执行，返回 `fallback` 或澄清，并打日志。

### 8.3 审计

- `SubTaskEnvelope.context` 或 `artifacts` 中记录 `guideId`、`queryTemplateId`、参数摘要（脱敏规则可配置）。

---

## 九、配置与环境变量（草案）

| 变量 | 说明 | 默认（建议） |
|------|------|----------------|
| `GUIDE_RETRIEVAL_TOP_K` | 召回返回候选数上限 | 5 |
| `GUIDE_CONFIDENCE_AMBIGUITY_DELTA` | Top1/Top2 分差低于此视为模糊 | 0.08 |
| `GLOBAL_MIN_RETRIEVAL_SCORE` | 低于则视为无可靠候选 | 0.35 |
| `SQL_ALLOW_RAW_FROM_LLM` | 是否允许非模板 SQL（生产建议 false） | false |

（与 `intentPolicy` 中澄清相关变量 **正交**，分开管理。）

---

## 十、测试与验收

| 类型 | 内容 |
|------|------|
| 单元 | frontmatter 解析；`slotValidation` 缺参/错型；模板绑定占位符一致；多候选阈值分支。 |
| 集成 | 同 `thread_id`：消歧 → 填槽 → 确认 → 执行；mock DB。 |
| 验收 | 至少一条 Guide 端到端可走通；日志含 `guideId`、分支名、**不**记录完整敏感参数（可配置）。 |

---

## 十一、实施顺序（推荐）

与 `design-skillguide-distributed-slots.md` §十一 一致，细化为可发 PR 的粒度：

1. **M6.1** 扩展 `SkillGuideEntry` + `scanGuides` 解析；无新字段的 Guide 行为不变。  
2. **M6.2** 主图注册 **独立 `guide_agent` 节点**（可先 stub 再填逻辑）+ `slotValidation` + 单 Guide 选定（人工或规则先写死 `selectedGuideId`）+ 模板绑定 + 执行；无多候选、无确认。  
3. **M6.3** `guideRetrieval`（关键词/tags）+ 置信度 + **`disambiguation` 分支与 compose**。  
4. **M6.4** `pendingConfirmation` + 用户确认回合 + 条件边。  
5. **M6.5** 与 `checkpoint` / `conversationTurns` 联调；企微 `formatFinalAnswerForChannel` 覆盖新类型。  
6. **M6.6** 收紧 `sql-query` 调用路径（模板优先、`allowRawSql` 开关）。

---

## 十二、开放问题与备选方案（供评审修改）

以下为 **当前轮次推荐默认**（可在评审会改票）；未写「待定」的项按推荐实施。

| # | 议题 | 备选 | **推荐默认** | 说明 |
|---|------|------|--------------|------|
| 1 | 主图形态 | 独立 `guide_agent` / 并入 `intent_agent` | **已拍板：独立 `guide_agent`** | 与 §六一致；**不采用**「并入 intent」方案。 |
| 2 | 参数存放 | 方案 1 双字段 / 方案 2 单一 `resolvedSlots` | **已拍板：方案 1** | **`guideResolvedParams`** = Guide 契约内精参；**`intentResult.resolvedSlots`** = 粗粒度；执行前 **`mergeParamsForExecution`**（§7.1.2），同名键 **Guide 覆盖意图**。 |
| 3 | 消歧超时 | 与 `CLARIFICATION_IDLE_MS` 共用 / 独立 `DISAMBIGUATION_TTL_MS` | **首版共用** | 减少配置项；若线上出现「长期悬挂选项」再拆独立 TTL。 |
| 4 | 确认防重放 | 必做 `sqlPreviewHash` / 仅 `pendingConfirmation` | **MVP 仅 pendingConfirmation** | 同 `thread_id` 会话内一致性即可；金融级防篡改后续再加哈希或服务端 token。 |
| 5 | 向量检索 | 本里程碑必做 / 后续 | **后续增强** | 首版 **tags + 关键词 + domain**；与 `skills-dynamic-disclosure-spec` 披露链路对齐后再接向量。 |

### 12.1 与父文档关系

- **执行清单**：`docs/intent-recognition-execution-plan.md` 里程碑 **6**。  
- **概念与修改清单**：`docs/design-skillguide-distributed-slots.md`（本文不重复其全文，仅收敛契约与状态机）。  
- **披露与技能**：`docs/skills-dynamic-disclosure-spec.md`（里程碑 6 实施后宜增加交叉引用小节，另 PR 处理）。

---

## 十三、修订记录

| 日期 | 说明 |
|------|------|
| 2026-03-28 | 初稿：里程碑 6 独立详细设计（契约、状态机、模块、顺序、开放问题） |
| 2026-03-28 | **主图定案**：采用独立 `guide_agent` 节点；更新 G0、§1.3、§五、§六.1、§十二-1。 |
| 2026-03-28 | 新增 **§6.4 `guide_agent` 详细执行算法说明**（入口短路、主流程步骤、召回/校验/消歧/确认子算法、输出表）。 |
| 2026-03-28 | **已定案参数方案**：采用 **方案 1**（`guideResolvedParams` + 粗 `resolvedSlots`）；新增 §7.1.1 / §7.1.2；更新 §二、§六、§八、§十二-2。 |
