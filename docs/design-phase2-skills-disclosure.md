## 阶段二详细设计：技能注册与动态披露

本阶段在阶段一「主 Orchestrator + DataQuery 最小闭环」基础上，建立 **可扩展的技能体系底座**：统一元数据、注册表、约定式发现，并在子 Agent 内用「按域获取 + 运行时收集 `usedSkills`」替代硬编码 `import`，为后续向量检索与上千技能规模铺路。

**规范依据（接口与实现细节以规范为准）**：

- `docs/skills-dynamic-disclosure-spec.md` — SkillDef、Registry、披露层级 L0/L1/L2、分层路由流程
- `docs/context-collaboration-spec.md` — 主/子协作、大结果不落 State
- `docs/overview-architecture.md` — 能力层、技能分层

**下一阶段**：阶段三见 `design-phase3-analysis.md`（DataAnalysisAgent 与「查 + 分析」）。

---

### 〇、下一阶段（阶段二）分步骤清单

按 **依赖顺序** 执行；上一步未稳勿大规模进入下一步。

| 步骤 | 内容 | 对应里程碑 |
|------|------|------------|
| **1** | 新增 `SkillDef` / `SkillContext` / `SkillMeta`（`src/skills/types.ts` 等） | M1 一部分 |
| **2** | `sqlQuerySkill` 导出 `skillDef`（建议 id：`sql-query`），`run` 内调用现有 `runSqlQuerySkill` | M1 |
| **3** | 实现 `registry.ts`：`registerSkill`、`getSkill`、`listSkillsByDomain`、`getDisclosureMeta`；补最小单测 | M2 |
| **4** | 实现 `getSkillsInfoSkill.ts`（id：`get-skills-info`），只读 Registry | M2.5 |
| **5** | 实现 `discovery.ts` + 启动时 `discoverAndRegisterSkills()`；`package.json` 增加 `fast-glob`（或等价）；`index.ts` / bootstrap 最先调用 | M3 |
| **6** | 实现 `invokeSkillSkill.ts`（id：`invoke-skill`），`run` 内 `getSkill(skillId).run(input, ctx)`，防递归 | M3.5 |
| **7** | 改造 `dataQueryGraph`：执行路径经 Registry（或经 `invoke-skill`）；`dataQueryAgent` 收集真实 `usedSkills` | M4 |
| **8** | 跑通 `npm run dev` 验收：`debug` / 日志中有稳定 skill id；`artifacts` 与阶段一一致；可选单测覆盖 registry | M5 |
| **9**（可选） | 编排器 **条件边**：仅 `data_query` 进入查询节点（非本阶段文档必做，但建议） | — |
| **10**（可选） | 需要 API 步骤时增加 **`http-request` / `http-skill`**，与 DataQuery `ApiQueryStep` 同迭代 | §2.4 候选 |

**阶段二完成后**再进入：`design-phase3-analysis.md`（DataAnalysisAgent）。

---

### 一、阶段目标

| 目标 | 说明 |
|------|------|
| **可扩展** | 技能从「几十个」增长到更多时，不靠全局静态 import 列表维护 |
| **可发现** | 通过 Registry +（后续）向量检索定位相关技能 |
| **可追溯** | `SubTaskResult.debug.usedSkills` 记录**实际调用**的 skill id，非硬编码 |
| **渐进披露** | 先暴露元数据（L1），执行时再加载完整实现（L2），控制上下文体积 |

---

### 二、范围界定

#### 2.1 本阶段必做（Do）

1. **契约落地**  
   - 在代码中固定 `SkillDef` / `SkillContext`（与规范一致）；  
   - 现有 `sqlQuerySkill`（及 Demo 域内技能）改为导出 `skillDef`，含 `id、name、description、domain、capabilities、exampleQueries、run`。

2. **Skill Registry**  
   - 实现 `registerSkill` / `getSkill` / `listSkillsByDomain`；  
   - 实现 `getDisclosureMeta(ids)`：仅返回可放入上下文的元数据（不含 `run` 或按需剥离）。

3. **约定式发现（Convention-based Discovery）**  
   - 按规范目录约定扫描 `**/*Skill.ts`（或项目约定后缀）；  
   - 启动时 `discoverAndRegisterSkills()` 一次，输出 discovered 数量与错误列表；  
   - 在 `src/index.ts` 或 `bootstrap` 中集成（见规范 4.2）。

4. **DataQuery 子图接入**  
   - `dataQueryGraph` 或域路由节点：按 `queryDomain` 从 Registry 取候选技能（初期可仍为规则选定 1 个 skill，但**调用路径**经 `getSkill(id).run`）；  
   - `dataQueryAgent`：`usedSkills` 由执行过程追加，不再写死 `["sqlQuerySkill"]`。

5. **观测**  
   - 日志或 debug 中可看到本次任务使用的 skill id 列表。

6. **两个基础技能（Core Skills）**  
   - **`get-skills-info`**（建议 id：`get-skills-info`）：封装对 Registry 的只读查询，向 Agent/编排器暴露 **L1 元数据**（`id/name/description/domain/capabilities/exampleQueries`），不返回、不执行 `run`。  
     - 典型输入：`{ domain?: string; ids?: string[] }`（二选一或组合，具体以实现为准）。  
     - 典型输出：`{ skills: SkillMeta[] }` 或等价结构。  
     - **依赖**：`SkillDef`、`getDisclosureMeta` / `listSkillsByDomain` 已就绪。  
   - **`invoke_skill`**（建议 id：`invoke-skill`）：**统一执行入口**，`run` 内根据入参调用 `getSkill(skillId)?.run(input, ctx)`，注入 `SkillContext`（如 `dbClient`、`env`、`threadId`、`taskId`）；与「技能很多时只绑少量 tool」配合，LLM 可通过 **`get-skills-info` + `invoke-skill`**（再经 `model.bindTools`）完成动态选技能与执行，而无需为每个技能单独绑 tool。  
     - 典型输入：`{ skillId: string; input: unknown }`（可与 `inputSchema` 校验策略对齐）。  
     - 典型输出：被调用技能的返回值，或统一包装 `{ ok: boolean; data?: unknown; error?: string }`（以实现约定为准）。  
     - **依赖**：Registry 已就绪且目标技能已注册；需注意 **禁止无防护递归**（例如 `invoke-skill` 间接再次调用自身）。  

   二者均以独立 `*Skill.ts` 导出 `skillDef`，`domain` 建议为 **`core`**，与其它业务技能一并被约定式发现注册。

#### 2.2 本阶段不做（Not Do）

- **不**引入向量库与向量检索（规范 §4.3、阶段三可选）— 本阶段以规则 + Registry 为主；  
- **不**要求实现技能热更新/多进程隔离（可作为后续）;  
- **不**替代阶段三的 DataAnalysisAgent；分析类技能可先仅占位注册，不强制完整图。

#### 2.3 与规范文档 §「分阶段落地」的对应

| 原规范表述 | 本仓库阶段编号 |
|------------|------------------|
| 规范 Phase 1（当前静态调用） | 阶段一（已完成） |
| 规范 Phase 2（Registry + 发现 + Agent 接入） | **本阶段二** |
| 规范 Phase 3（向量检索 + 完整披露链路） | **阶段三或阶段二.5 扩展**（见下文） |

#### 2.4 其它可作为「基础技能（Core）」后续创建的候选

与总体架构中「通用技能 / Core Skills」一致，除本阶段必做的 `sql-query`、`get-skills-info`、`invoke-skill` 外，可按需增量实现（**非本阶段必做**，避免范围膨胀）：

| 候选 id | 职责概要 | 建议落地时机 |
|---------|----------|----------------|
| `file-read` / `file-write` | 读写 `artifacts/` 或受限目录，封装路径安全（threadId/taskId 前缀） | 大结果落盘规范强化或与分析子 Agent 联动时 |
| `http-request` | 轻量 HTTP（method、url、headers、body），支撑 DataQuery 中 **API 类执行步骤** | 实现多步 API 查询时 |
| `skill-retriever` | 用户问题 → TopN skill ids；初期可规则/关键词占位，向量检索接规范 Phase 3 | 技能数增多或阶段 2.5 |
| `web-search` | 外部网页/新闻检索（可选） | 有明确产品需求时 |
| `route-domain` | 将「高层域路由」封装为可调用技能，便于与 Planner 统一 | 编排器复杂化、需可观测路由时 |
| `knowledge-base-query` | 向量库检索 / RAG（与 `skill-knowledge-base` 对齐） | 接入向量库后 |
| `load-skills` / 仅运维调用 `discoverAndRegisterSkills` | 热重载磁盘发现（**不推荐**作为默认用户侧 tool；见前文架构讨论） | 开发调试或受控运维场景 |

---

### 三、实施里程碑（建议顺序）

1. **M1 — 类型与单技能试点**  
   - 新增 `src/skills/types.ts`（或等价）定义 `SkillDef`；  
   - `sqlQuerySkill` 导出 `skillDef`，`run` 内调用现有 `runSqlQuerySkill`。

2. **M2 — Registry + 单测**  
   - `registry.ts` 实现；单元测试 `register` / `get` / `listSkillsByDomain`。

3. **M2.5 — 基础技能 `get-skills-info`**  
   - 新增 `src/skills/core/getSkillsInfoSkill.ts`（或同级命名），导出 `skillDef`；  
   - `run` 内调用 `listSkillsByDomain` / `getDisclosureMeta`，返回 JSON 可序列化结构；  
   - **不**依赖 discovery，仅需 Registry 已有数据（可与 M1 的 `sql-query` 手工 `register` 联调后再接发现）。

4. **M3 — discoverAndRegisterSkills**  
   - `discovery.ts` + 目录约定；`package.json` 视需要增加 `fast-glob` 等依赖；  
   - 启动时调用，失败项 `console.warn` 不阻塞启动（可配置）。

5. **M3.5 — 基础技能 `invoke_skill`（`invoke-skill`）**  
   - 新增 `src/skills/core/invokeSkillSkill.ts`（或同级命名），导出 `skillDef`；  
   - `run` 内解析 `{ skillId, input }`，调用 `getSkill(skillId)?.run(input, ctx)`，组装 `SkillContext`；  
   - 与 **M4** 衔接：DataQuery 子图可直接调 Registry，或统一经 `invoke-skill`（二选一或并存，以实现为准）；  
   - 明确与 `get-skills-info`、后续 `model.bindTools` 的配合方式（见 §2.1 第 6 条）。

6. **M4 — DataQuery 路径改造**  
   - 子图内从 Registry 解析并执行 skill；**收集** `usedSkills` 写入 `SubTaskResult.debug`。

7. **M5 — 文档与验收**  
   - 更新 `skills-use.md` 交叉引用；  
   - 验收：一次查询请求日志中出现真实 skill id，且 `artifacts` 行为与阶段一一致；  
   - 可选：在测试中或 demo 中调用 `get-skills-info` / `invoke-skill`（如对 `sql-query` 发起一次合法 `input`）各一次，确认返回结构稳定。

---

### 四、可选扩展（阶段二完成后）

- 当技能数 **> 30～50**：按规范引入 **向量检索**（独立 PR 或记为「阶段 2.5」）；  
- **分层路由** 细化：`skill-route-domain` 与域内 `listSkillsByDomain` + 规则 Top1。

---

### 五、交付物清单

| 交付物 | 说明 |
|--------|------|
| `SkillDef` 与 Registry 实现 | 可注册、可查询 |
| `discoverAndRegisterSkills` | 约定式扫描注册 |
| 基础技能 `get-skills-info`、`invoke-skill` | 元数据查询与统一执行入口，均以 `skillDef` 注册 |
| DataQuery 路径改造 | 经 Registry 执行，usedSkills 运行时收集 |
| 规范更新 | `skills-dynamic-disclosure-spec.md` §六 与本文档阶段编号一致 |

---

### 六、参考文档

- `docs/skills-dynamic-disclosure-spec.md` — 完整契约与代码示例  
- `docs/skills-use.md` — 大规模技能与分层策略  
- `docs/design-phase1-minimal-loop.md` — 阶段一前置  
- `docs/design-phase3-analysis.md` — 阶段三（数据分析子 Agent）
