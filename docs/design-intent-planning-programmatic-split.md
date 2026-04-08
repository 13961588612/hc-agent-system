# 意图识别提速方案：LLM 与程序职责拆分

## 背景

当前意图阶段承担了过多结构化生成工作（含 `planningTasks`、缺参判定、可执行性判定、澄清话术），导致：

- 首轮提示词和返回 JSON 体积偏大，LLM 耗时高。
- 同一输入下结构输出不稳定（尤其 step 粒度字段）。
- 缺参与可执行性判定依赖模型“推断”，难以保证一致性。

目标是将“可规则化”的部分下沉到程序，LLM 只保留语义理解与自然语言生成。

---

## 总体方案（三阶段）

### 阶段 1：LLM 粗识别（轻输出）

LLM 仅输出：

- `intents[].intent`
- `intents[].goal`
- `intents[].confidence`
- 可选：`resolvedSlots`（仅作 hint）
- 可选：`domainId/segmentId`（仅作 hint）

LLM 不再输出最终权威的：

- `planningTasks[]`
- `skillSteps[]`
- `missingSlots/missingParams`
- `executable/planPhase/needsClarification`

### 阶段 2：程序生成规划（权威结构）

内部程序根据：

- 阶段 1 输出（粗意图 + 槽位 hint）
- `system.yaml`
- `SkillCatalog` / `GuideRegistry`
- 参数词典与别名映射

生成完整规划结构：

- `planningTasks[]`（含 `taskId`、`systemModuleId`、`goal`）
- `skillSteps[]`（含 `stepId`、`selectedSkillId`、`selectedSkillKind`）
- 默认执行配置（如 `executionSkillId`、`dbClientKey`、`expectedOutput`）

### 阶段 3：程序判参 + 条件触发澄清 LLM

程序基于 guide `params.required` 判定：

- `requiredParams/providedParams/missingParams`
- `step.executable/task.executable`
- 根级 `needsClarification/planPhase`

仅当缺参时，触发轻量 LLM 生成 `clarificationQuestion`。
若失败，回退模板文案。

---

## 字段责任边界（建议）

- **LLM 负责**：`intent`、`goal`、`confidence`、（可选）槽位候选。
- **程序负责**：所有执行相关结构字段与门闸字段。
- **冲突策略**：程序结果覆盖 LLM 同名字段（程序为最终权威）。

---

## 可程序化替代清单（对应 `intent-planning-decompose-and-orchestrate.md`）

- 总体执行顺序中的 3/4/5 步（锚点、规划、门闸）全部程序化。
- `selectedSkillId/selectedSkillKind` 由目录规则选取，不由 LLM 硬填。
- `requiredParams/missingParams/executable` 由参数定义和槽位映射计算。
- `planPhase/needsClarification` 由规则计算。
- `replyLocale` 默认策略可程序化（按 channel/user 配置）。
- `clarificationQuestion` 仅保留 LLM 生成（缺参时）。

---

## 需要新增的程序能力

1. **DeterministicPlanningTasksBuilder**
   - 输入：粗意图 + 目录元数据 + 配置
   - 输出：完整 task/step 结构

2. **SlotNormalizer**
   - 统一槽位别名（如 `vipId/mobile/memberCardNo`）
   - 将 LLM hint 归一化为系统标准键

3. **ParamChecker**
   - 基于 guide `params.required` 计算 `missingParams`
   - 回写 step/task/root 级可执行状态

4. **ClarificationGenerator（轻量）**
   - 仅在缺参时调用
   - 支持失败降级模板

---

## 性能收益预期

- 首轮 LLM 输出 token 显著减少（不再生成大段 `planningTasks` JSON）。
- 意图阶段平均耗时下降（目标 20%+）。
- 判定逻辑稳定、可复现，减少“同问不同规划”的抖动。

---

## 风险与对策

- 风险：规则不足导致规划覆盖不全。  
  对策：先覆盖 `data_query/member` 高频路径，逐步扩域。

- 风险：程序选 skill 与真实语义偏差。  
  对策：保留 LLM 候选 id 作为排序信号，不作为最终权威。

- 风险：澄清话术质量下降。  
  对策：仅文案交给 LLM；并保留模板回退。

---

## 分步落地建议

1. 先改首轮 LLM 输出契约（瘦身）。
2. 落地程序化 `planningTasks` 生成（先单任务）。
3. 接入程序化缺参判定与 `planPhase`。
4. 加缺参条件下的澄清 LLM。
5. 扩展多任务依赖与更多业务分段。

---

## 验收标准

- 同输入下 `planningTasks` 结构稳定（可单测）。
- 缺参判定与 `needsClarification` 一致且可解释。
- 不缺参场景不触发澄清 LLM。
- 链路日志具备阶段耗时：`intent_llm_ms`、`deterministic_planning_ms`、`clarify_llm_ms`。
