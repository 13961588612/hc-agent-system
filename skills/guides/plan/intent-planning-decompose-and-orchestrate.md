---
id: intent-planning-decompose-and-orchestrate
kind: guide
title: 通用意图识别与任务规划 Guide
description: 供 intentClassifyAgent 调用的统一意图识别与任务规划规则；要求输出可被 IntentResultSchema 校验通过的 JSON。
domain: intent
segment: common
relatedSkillIds:
tags:
  - 意图
  - intent
  - planning
---

## Guide Spec: `intent.planning.decompose-and-orchestrate`

### 1) 总体执行顺序

1. 输入归并：整合用户问题、上下文和可用 guide/skill 线索。  
2. 意图识别：输出 `intents[]`，标注 `goal/confidence/executable/missingSlots`。  
3. 上下文锚点：补齐 `domainId/segmentId`，并在 step 里给出 `selectedSkillId` 与 `selectedSkillKind`。  
4. 任务规划：输出 `planningTasks[]` 和 `skillSteps[]`，明确参数状态与先后依赖。  
5. 执行门闸：根据缺参决定 `planPhase` 与 `needsClarification`。  
6. 回答控制：补齐 `replyLocale/clarificationQuestion/replySuggestion`。  

### 2) 字段级约束（无 capability 口径）

- `executionSkillId` 表示最终执行技能（如 `sql_query`）。
- `expectedOutput` 建议写成 `resultType=<type>;resultPath=result.rows`。

### 3) 规划规则

- 多任务按数组顺序串行：`task-1 -> task-2 -> ...`。
- 缺关键参数时：`planPhase="blocked"` 且 `needsClarification=true`。
- 可执行时：`planPhase="ready"` 且至少一条 task `executable=true`。
- 依赖上游结果的 step，当前轮应标记 `executable=false` 并写明 `missingParams`。

### 4) 返回结果标准

- 仅返回一个 JSON 对象，不输出解释文字。
- 必须可通过 `src/contracts/intentSchemas.ts` 的 `IntentResultSchema` 校验。
- 不执行真实业务查询（本阶段只做识别与规划）。

### 5) 执行影响与判定表

`executable=false` + `missingParams` 会直接影响后续执行门闸：该 step 在本轮不应执行（不发 SQL）。

| 场景 | 判定 | 规划动作 |
|------|------|----------|
| step 无缺参 | `step.executable=true` | 进入执行队列 |
| step 有缺参，且可由前置 step 产出补齐 | `step.executable=false` | 先安排前置 step，等待回填后再执行 |
| step 有缺参，且必须用户补充 | `step.executable=false` | 上提澄清问题，进入 `needsClarification=true` |
| task 内至少一个 step 可执行 | `task.executable=true` | 允许先执行可执行 step |
| task 内全部 step 不可执行 | `task.executable=false` | 暂不执行该 task，走澄清或等待依赖 |

### 6) 规划流程（可直接套用）

1. 先算每个 step 的 `missingParams`。  
2. 若 `missingParams=[]`，标记 `step.executable=true`。  
3. 若有缺参，判断缺参来源：  
   - 可由前序 step 输出映射得到 -> `step.executable=false`，写依赖关系；  
   - 必须用户补充 -> `step.executable=false`，并生成 `clarificationQuestion`。  
4. 汇总 task：  
   - 至少一个 step 可执行 -> `task.executable=true`；  
   - 全不可执行 -> `task.executable=false`。  
5. 汇总全局：  
   - 存在“必须用户补充”的关键缺参 -> `planPhase="blocked"` + `needsClarification=true`；  
   - 否则可 `planPhase="ready"`，先跑可执行链路。  
