# SkillGuide 分布式槽位与检索执行（置信度 / 多候选 / 用户确认）

本文档说明：在 **SkillGuide** 中声明**每查询模板的参数契约**（分布式槽位），结合 **置信度**、**多候选澄清**、**执行前用户确认**，由大模型驱动 `sql-query` 等技能执行；并列出**需要修改的代码与文档清单**。

**关联文档**：`docs/design-intent-recognition.md`（编排层意图与 §11 问数主题）、`docs/skills-dynamic-disclosure-spec.md`（技能披露）、`docs/context-collaboration-spec.md`（大结果与 artifacts）。

---

## 一、目标与原则

| 目标 | 说明 |
|------|------|
| 分布式槽位 | 不在全局写死一张槽位表；每个 Guide 对应「一种可执行查询模板」，自带 `required_params` / `optional_params`。 |
| 可自动校验 | 运行时根据**当前选中的 Guide + 已解析参数**做集合运算，判断是否可执行。 |
| 置信度 | 对「选哪条 Guide」「参数是否填对」输出分数或等级，驱动是否追问、是否请人确认。 |
| 多候选澄清 | TopK 条 Guide 分数接近时，列出选项让用户选或说编号。 |
| 用户确认 | 执行 SQL 前展示「将使用哪条模板 + 关键参数摘要」，用户确认后再 `invoke-skill` / `sql-query`。 |
| 安全 | SQL 以 **模板 + 占位符 + 参数绑定** 为主，避免模型直接拼任意 SQL（与现有 `sql-query` 能力对齐并加强）。 |

---

## 二、SkillGuide 元数据扩展（frontmatter）

**修改面**：`skills/guides/**/*.md` 示例与约定；`src/guides/types.ts`、`src/guides/scanGuides.ts` 解析逻辑。

建议在 YAML 中增加（字段名可微调，但需一次性定稿）：

```yaml
# 与现有 id / kind / title / domain / segment / relatedSkillIds / tags 并存

# 可选：本 Guide 对应的稳定查询模板 id（与 §11 target_intent 可映射）
queryTemplateId: member.profile

# 分布式槽位：机器可读
params:
  required:
    - name: member_id
      type: string
      description: 会员内部 ID 或业务主键
      examples: ["13800138000", "M10001"]
  optional:
    - name: time_range
      type: object
      description: 查询时间范围

# 执行契约（供自动校验与展示）
execution:
  skillId: sql-query           # 实际调用的技能 id
  sqlTemplateRef: inline       # 或 path: 指向片段；inline 表示正文代码块
  confirmBeforeRun: true       # 是否必须先用户确认
  minConfidence: 0.72          # 低于则只追问/澄清，不执行
```

**正文约定**：保留现有「数据源、条件说明、SQL、返回含义」；可增加 fenced 代码块标记 **`sql-template`**，占位符与 `params.name` 一致（如 `:member_id` / `?` 与技能约定统一）。

---

## 三、类型与注册表（代码）

| 修改文件 | 内容 |
|----------|------|
| `src/guides/types.ts` | 扩展 `SkillGuideMeta` / `SkillGuideEntry`：`queryTemplateId?`、`params?`（Zod 或 TS 接口）、`execution?`（`skillId`、`confirmBeforeRun`、`minConfidence` 等）。 |
| `src/guides/scanGuides.ts` | `parseGuideFile`：解析新 YAML 字段；校验 `params.required[].name` 非空；非法则记入 `errors` 不注册或降级。 |
| `src/guides/guideRegistry.ts`（若存在） | 支持按 `queryTemplateId` / `id` 检索；可选 `listByDomain` / `searchByTags`。 |

---

## 四、Guide 召回与打分（置信度）

| 新增或修改 | 内容 |
|------------|------|
| **新模块** `src/guides/guideRetrieval.ts`（名可调整） | 输入：`userInput`、可选 `conversationSummary`、`domain`；输出：`candidates: Array<{ guideId, score, reasons }>`。实现可选：**关键词 + tags** → 未来 **向量检索**（与 `skills-dynamic-disclosure-spec` 对齐）。 |
| **置信度策略** | 单候选且 `score >= guide.execution.minConfidence` → 可进入填槽；多候选且 top1-top2 差小于阈值 → **多候选澄清**；低于全局 `minConfidence` → 通用追问或拒答。 |
| **配置** | `env` 或 `config`：`GUIDE_RETRIEVAL_TOP_K`、`CONFIDENCE_AMBIGUITY_DELTA`（多候选阈值）。 |

---

## 五、分布式槽位填充与校验

| 新增或修改 | 内容 |
|------------|------|
| **新模块** `src/guides/slotValidation.ts` | 输入：选中的 `SkillGuideEntry`、`record<paramName, value>`（由 LLM 从多轮对话抽取）；输出：`{ satisfied: boolean; missing: string[]; invalid: ... }`。规则：`required` 每个 `name` 在 record 中有非空合法值。 |
| **LLM 抽取** | 新 agent 或意图节点子步骤：输出 JSON `{ params: {...}, confidence: number }`，与 Guide 的 `params` 定义对齐；失败则 `missing` 全量必填项。 |
| **与 §11 映射** | 可选：将 `target_intent`（如 `member.profile`）映射到 `queryTemplateId`，统一路由到同一条 Guide。 |

---

## 六、多候选澄清与用户确认（编排层）

| 修改文件 | 内容 |
|----------|------|
| `docs/design-intent-recognition.md` | 补充：多候选时 `finalAnswer.type = "disambiguation"`，结构含 `options[]`（title、guideId、一句摘要）。 |
| `src/contracts/schemas.ts` / `types.ts` | `OrchestratorState` 增加：`activeGuides?: string[]`（候选 id）、`pendingConfirmation?: { guideId, paramsSummary }`、`retrievalScores?: Record<string, number>`（可选，调试用）。 |
| `src/graph/orchestrator/composeAnswerNode.ts` | 分支：`disambiguation` / `awaiting_confirmation` / `clarification` / `data_query`。 |
| **新节点或意图子逻辑** | `select_guide`：召回 → 打分 → 若多候选则直接 `compose` 追问；若单候选则进入填槽 → `slotValidation` → 若 `confirmBeforeRun` 则设 `pendingConfirmation` 并 **不执行 SQL**。 |
| **用户确认回合** | 下一轮用户输入「确认 / 是 / 1」→ 解析后与 `pendingConfirmation` 匹配 → 再调用 `execute_data_query` 或专用 **`invoke_sql_from_guide`** 节点。 |

---

## 七、sql-query 与技能层

| 修改文件 | 内容 |
|----------|------|
| `src/skills/core/sqlQuerySkill.ts` | 支持入参：`sql` + `params` 来自 Guide 模板绑定；**禁止**无模板时执行任意长 SQL（若保留兼容，需 `allowRawSql` 开关且默认 false）。 |
| **新包装**（可选）`runSqlFromGuideGuide` | 输入：`guideId` + `params`；内部从 `getGuide` 取模板与 `relatedSkillIds`，调用 `sql-query`。 |
| `src/agents/dataQueryAgent.ts` | `SubTaskEnvelope` 中可带 `refs` 指向选用的 `guideId` / `queryTemplateId`；落盘 `artifacts` 便于审计。 |

---

## 八、入口与多轮状态

| 修改文件 | 内容 |
|----------|------|
| `src/graph/orchestrator/orchestratorGraph.ts` | 条件边：`needs_clarification` / `needs_disambiguation` / `needs_confirmation` / `ready_to_execute`。 |
| `src/graph/orchestrator/orchestratorGraph.ts` 中 `runOrchestratorGraph` | 合并 `conversationTurns`；**checkpoint**（见 `design-intent-recognition` §八）持久化 `pendingConfirmation`、`activeGuides`。 |
| `src/channels/wecom/*.ts` | 将用户消息与 bot 回复写入 `conversationTurns`；确认类快捷回复可映射为结构化事件。 |

---

## 九、文档与示例

| 文件 | 内容 |
|------|------|
| `skills/guides/README.md` | 增加 `params` / `execution` 字段说明与示例。 |
| `skills/guides/member/member-profile-query.md` | 按 §二 补全示例 frontmatter + `sql-template` 片段。 |
| `docs/skills-dynamic-disclosure-spec.md` | 增加「Guide 与可执行技能绑定」「分布式槽位」小节，指向本文档。 |

---

## 十、测试与观测

| 项 | 说明 |
|----|------|
| 单元测试 | `slotValidation`、frontmatter 解析、`parseOracleJdbcUrl` 无关；测 Guide 缺字段、多候选阈值。 |
| 集成测试 | 多轮：召回 → 澄清 → 填槽 → 确认 → 执行；mock `DbClient`。 |
| 日志 | `guideId`、`scores`、`missing_slots`、`confirmed: boolean` 写入 debug 或 LangSmith。 |

---

## 十一、建议实施顺序（里程碑）

1. **扩展 `SkillGuideEntry` + 解析器**（不破坏现有无新字段的 Guide）。  
2. **slotValidation + 单 Guide 填槽**（无多候选、无确认）。  
3. **召回 + 置信度 + 多候选澄清**（`disambiguation`）。  
4. **confirmBeforeRun + 状态机回合**（`pendingConfirmation`）。  
5. **checkpoint + conversationTurns**（多轮继承参数）。  
6. **收紧 sql-query**（模板化优先）。

---

## 十二、修订记录

| 日期 | 说明 |
|------|------|
| 初稿 | SkillGuide 分布式槽位、置信度、多候选、确认与修改清单 |
