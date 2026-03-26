# Skills 动态披露规范

本文档定义 agent-system 中 **Skills 动态披露** 的设计目标、接口契约与实现方案，用于支撑从几十到上千个技能的可扩展架构。

---

## 一、概念与目标

### 1.1 什么是动态披露

**动态披露（Dynamic Disclosure）** 指：不在启动时将所有技能完整加载进 Agent 上下文，而是按需、分阶段、有选择地暴露技能信息，从而：

- **控制上下文体积**：避免 1000 个技能描述导致 Token 爆炸；
- **提高决策质量**：Agent 只看到与当前任务相关的技能，减少干扰与误选；
- **支持渐进式加载**：先暴露元数据（name、description、example），选中后再加载完整实现。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **可扩展** | 支持技能数量从几十增长到上千，无需重构架构 |
| **可发现** | 通过路由 + 向量检索，快速定位相关技能 |
| **可追溯** | 记录每次任务实际使用的技能（`usedSkills`），便于审计与优化 |
| **与现有规范兼容** | 遵守 `context-collaboration-spec.md`，不污染主/子 Agent 上下文 |

---

## 二、当前状态与差距

### 2.1 当前实现（Phase 1）

- **静态调用**：`dataQueryGraph` 直接 `import` 并调用 `runSqlQuerySkill`；
- **硬编码**：`usedSkills` 在 `dataQueryAgent` 中写死为 `["sqlQuerySkill"]`；
- **无注册表**：没有统一的技能注册与发现机制；
- **无元数据检索**：无法按用户问题动态召回相关技能。

### 2.2 目标状态

- **Skill Registry**：统一注册所有技能，包含 id、name、description、capabilities、exampleQueries；
- **分层路由**：先按域（data_query / data_analysis / smart_form）路由，再在域内按意图召回；
- **向量检索**：将技能元数据向量化，按用户问题召回 TopN；
- **运行时收集**：执行时记录实际调用的技能到 `SubTaskResult.debug.usedSkills`。

---

## 三、Skill 元数据契约

### 3.1 SkillDef 接口

每个技能需提供可被「披露」的元数据，用于注册与检索：

```ts
interface SkillDef {
  /** 唯一标识，如 sql-query、member-points-query */
  id: string;

  /** 展示名称 */
  name: string;

  /** 简短描述，用于向量检索与 Agent 决策（建议 ≤100 字） */
  description: string;

  /** 能力标签，如 ["sql", "member", "points"] */
  capabilities?: string[];

  /** 示例查询，用于向量检索召回 */
  exampleQueries?: string[];

  /** 所属域，用于分层路由 */
  domain?: "data_query" | "data_analysis" | "smart_form" | "core";

  /** 输入 schema 描述（可选，用于工具调用时校验） */
  inputSchema?: Record<string, unknown>;

  /** 实际执行函数 */
  run: (input: unknown, context?: SkillContext) => Promise<unknown>;
}

interface SkillContext {
  dbClient?: DbClient;
  env?: EnvConfig;
  threadId?: string;
  taskId?: string;
}
```

### 3.2 披露层级

| 层级 | 内容 | 用途 |
|------|------|------|
| **L0：路由层** | 仅 domain + id | 域内路由，决定走哪条子图 |
| **L1：元数据** | id、name、description、exampleQueries | 向量检索、Agent 初选 |
| **L2：完整** | 含 inputSchema、run | 选中后加载执行 |

---

## 四、实现方案

### 4.1 Skill Registry（技能注册表）

```ts
// src/skills/registry.ts

const skillRegistry = new Map<string, SkillDef>();

export function registerSkill(def: SkillDef): void {
  skillRegistry.set(def.id, def);
}

export function getSkill(id: string): SkillDef | undefined {
  return skillRegistry.get(id);
}

export function listSkillsByDomain(domain: string): SkillDef[] {
  return Array.from(skillRegistry.values()).filter((s) => s.domain === domain);
}

/** 返回可披露的元数据（不含 run） */
export function getDisclosureMeta(ids: string[]): SkillMeta[] {
  return ids
    .map((id) => skillRegistry.get(id))
    .filter(Boolean)
    .map((s) => ({
      id: s!.id,
      name: s!.name,
      description: s!.description,
      capabilities: s!.capabilities,
      exampleQueries: s!.exampleQueries,
      domain: s!.domain,
    }));
}
```

### 4.2 约定式发现（Convention-based Discovery）

约定式发现通过**目录结构 + 导出约定**，在启动时自动扫描并注册技能，无需手动 `registerSkill`。新增技能只需按约定创建文件即可被发现。

#### 4.2.1 目录与文件约定

```
src/skills/
├── index.ts              # 发现入口，导出 discoverAndRegisterSkills()
├── registry.ts            # Skill Registry 实现
├── core/                  # 通用底层技能（不绑定业务域）
│   ├── sqlQuerySkill.ts
│   └── ...
├── data_query/            # 数据查询域技能
│   ├── member/
│   │   ├── pointsQuerySkill.ts
│   │   └── ...
│   └── ecommerce/
│       ├── ordersQuerySkill.ts
│       └── ...
├── data_analysis/         # 数据分析域技能（可选）
│   └── ...
└── _convention.md         # 约定说明（可选，供开发者参考）
```

**文件命名**：`*Skill.ts` 或 `*.skill.ts`，便于 glob 匹配。

#### 4.2.2 导出约定

每个技能文件**必须**导出 `skillDef`（或 `default` 为 SkillDef）：

```ts
// src/skills/core/sqlQuerySkill.ts

import type { DbClient, SqlQueryResult } from "../../infra/dbClient.js";
import type { SkillDef, SkillContext } from "../types.js";

export interface SqlSkillInput {
  sql: string;
  params?: unknown[];
  purpose?: string;
}

export async function runSqlQuerySkill(
  input: SqlSkillInput,
  dbClient: DbClient
): Promise<SqlQueryResult> {
  // ... 实现
}

export const skillDef: SkillDef = {
  id: "sql-query",
  name: "SQL 查询",
  description: "执行安全参数化 SQL 查询，支持会员、电商等业务域",
  domain: "core",
  capabilities: ["sql", "database"],
  exampleQueries: ["查订单", "查积分", "查最近消费"],
  run: async (input, ctx) => {
    const db = ctx?.dbClient ?? new DummyDbClient();
    return runSqlQuerySkill(input as SqlSkillInput, db);
  },
};
```

**可选**：支持 `default` 导出，便于 `import()` 动态加载：

```ts
export default skillDef;
```

#### 4.2.3 发现器实现

```ts
// src/skills/discovery.ts

import { join } from "node:path";
import { glob } from "fast-glob";
import { registerSkill } from "./registry.js";
import type { SkillDef } from "./types.js";

/** 技能文件路径模式（相对于 src/skills） */
const SKILL_GLOB = "**/*Skill.ts";

/**
 * 约定式发现：扫描 skills 目录下符合约定的文件，动态 import 并注册。
 * 在应用启动时调用一次。
 */
export async function discoverAndRegisterSkills(
  baseDir: string = join(process.cwd(), "src", "skills")
): Promise<{ discovered: number; errors: string[] }> {
  const errors: string[] = [];
  let discovered = 0;

  const files = await glob(SKILL_GLOB, {
    cwd: baseDir,
    absolute: true,
    ignore: ["**/index.ts", "**/registry.ts", "**/_*"],
  });

  for (const file of files) {
    try {
      const mod = await import(file);
      const def: SkillDef | undefined = mod.skillDef ?? mod.default;

      if (!def || typeof def.run !== "function") {
        errors.push(`${file}: 缺少 skillDef 或 default 导出，或 run 非函数`);
        continue;
      }
      if (!def.id) {
        errors.push(`${file}: skillDef.id 必填`);
        continue;
      }

      registerSkill(def);
      discovered++;
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
    }
  }

  return { discovered, errors };
}
```

**依赖**：需引入 `glob`（如 `fast-glob` 或 Node 20+ `fs.glob`）用于文件扫描。

#### 4.2.4 启动时集成

```ts
// src/index.ts 或 src/bootstrap.ts

import { discoverAndRegisterSkills } from "./skills/discovery.js";

async function bootstrap() {
  const { discovered, errors } = await discoverAndRegisterSkills();
  if (errors.length > 0) {
    console.warn("[Skills] 发现阶段警告:", errors);
  }
  console.log(`[Skills] 已发现并注册 ${discovered} 个技能`);

  // 后续启动 Orchestrator、HTTP 等
  await runOrchestratorGraph(...);
}
```

#### 4.2.5 与 Registry 的协作

| 步骤 | 说明 |
|------|------|
| 1. 扫描 | `discoverAndRegisterSkills()` 遍历 `**/*Skill.ts` |
| 2. 加载 | 对每个文件 `import(path)` 获取模块 |
| 3. 校验 | 检查 `skillDef`/`default` 存在且含 `id`、`run` |
| 4. 注册 | 调用 `registerSkill(def)` 写入 Registry |
| 5. 就绪 | 子 Agent 通过 `getSkill(id)` / `listSkillsByDomain(domain)` 使用 |

#### 4.2.6 注意事项

- **循环依赖**：技能文件避免 import 其他技能，只 import 基础设施（dbClient、types）；
- **懒加载**：若技能很多，可改为「只扫描元数据、按需 import run」，需额外约定（如 `skillDef` 与 `run` 分文件）；
- **ESM**：`import()` 需使用完整路径，`glob` 返回 `absolute: true` 可满足；
- **测试**：单测可 mock `discoverAndRegisterSkills` 或直接 `registerSkill` 注入，不依赖真实文件系统。

### 4.3 向量检索（大规模场景）

当技能数量 > 50 时，建议引入向量检索：

1. **建索引**：将每个技能的 `description + exampleQueries` 拼接后向量化，存入 Pinecone / Chroma / Qdrant；
2. **召回**：用户问题向量化 → 检索 TopN（如 5～10）相关技能 id；
3. **披露**：仅将召回的技能元数据传给 Agent，其余不暴露。

### 4.4 分层路由 + 动态披露流程

```
用户问题
    ↓
IntentAgent（高层域：data_query / data_analysis / other）
    ↓
子 Agent 入口（如 DataQueryAgent）
    ↓
域内路由（member / ecommerce / ...）
    ↓
技能召回（规则 or 向量检索）→ 得到 TopN skill ids
    ↓
披露 L1 元数据给 Agent（或直接规则选定）
    ↓
执行：getSkill(id).run(input)
    ↓
记录 usedSkills 到 SubTaskResult.debug
```

---

## 五、与现有架构的衔接

### 5.1 与 context-collaboration-spec 的关系

- **主 Agent**：不直接持有技能列表，只通过子 Agent 的 `SubTaskResult` 获取 `usedSkills` 摘要；
- **子 Agent**：内部使用 Skill Registry / 检索器获取可披露技能，执行后回传 `usedSkills`；
- **Artifacts**：技能执行产生的大结果仍落盘，主 State 只存引用。

### 5.2 与 overview-architecture 的对应

| 架构层 | 动态披露角色 |
|--------|--------------|
| 编排层 | 不持有技能，只调度子 Agent |
| 子智能体层 | 各子 Agent 按域调用技能检索 + 执行 |
| 能力层 | Skill Registry、向量索引、技能实现 |

### 5.3 SubTaskResult 扩展

`SubTaskResult.debug` 已包含 `usedSkills`，动态披露后应**运行时收集**而非硬编码：

```ts
// 当前（硬编码）
debug: { usedSkills: ["sqlQuerySkill"] }

// 目标（运行时收集）
debug: {
  usedSkills: ["sql-query", "member-points-query"],  // 实际调用的 skill id
  usedTools?: string[],
  timingsMs?: Record<string, number>,
}
```

---

## 六、分阶段落地建议

> **与仓库阶段文档对齐**：里程碑级规划见 **`docs/design-phase2-skills-disclosure.md`**。下表「规范内 Phase」与「仓库阶段」对应关系见该文档 §2.3。

### Phase 1（规范内 / 仓库阶段一）

- 保持静态调用，`usedSkills` 可继续硬编码；
- 定义 `SkillDef` 接口，为 `sqlQuerySkill` 补充元数据结构（即使暂不注册）。

### Phase 2（规范内 / 仓库阶段二）

- 实现 `Skill Registry`，将现有技能迁移为注册式；
- 实现**约定式发现**（`discoverAndRegisterSkills`），启动时自动扫描并注册；
- 在 DataQueryAgent 内按 domain 从 Registry 获取技能列表，替代直接 import；
- `usedSkills` 改为执行时收集。

### Phase 3（规范内 / 可选在阶段二末或独立迭代）

- 引入向量检索（当技能数 > 30 时）；
- 实现「路由 → 检索 → 披露 L1 → 执行」完整链路；
- 支持技能热加载 / 动态注册（可选）。

**说明**：仓库 **阶段三** 主题为 **DataAnalysisAgent**（`design-phase3-analysis.md`），与规范文件本节 **Phase 3（向量检索）** 编号不同；向量检索可作为阶段二扩展或独立「2.5」迭代，避免混淆请以 `design-phase2-skills-disclosure.md` 为准。

---

## 七、参考

- `docs/design-phase2-skills-disclosure.md`：仓库阶段二里程碑与 **基础技能**（含 `get-skills-info`、`invoke-skill`）规划
- `docs/overview-architecture.md`：四层架构、技能分层
- `docs/context-collaboration-spec.md`：主/子协作、Artifacts
- `docs/skills-use.md`：大规模技能优化、分层+路由+向量检索
