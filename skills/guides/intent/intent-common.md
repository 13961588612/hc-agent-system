---
id: intent-common
kind: guide
title: 通用意图识别与任务编排 Skill
description: 供 intentClassifyAgent 调用的统一意图识别与编排规划 guide；要求输出可被 IntentResultSchema 校验通过的 JSON。
domain: intent
segment: common
relatedSkillIds:
tags:
  - 意图
  - intent
  - planning
---


## Capability Spec: `intent.common.decompose-and-orchestrate`

### 1) 总体执行顺序（先看这里）

本 guide 的核心目标：让 `intentClassifyAgent` 在一次调用中，稳定产出可校验、可编排、可执行的 JSON。

#### 第一步：输入归并
- 输入包含：当前用户问题 + 最近对话摘要 + 可用能力线索（规则/工具返回）。
- 先统一语义口径：当前轮是否需要澄清、是否可直接执行、是否需要拆多任务。

#### 第二步：意图识别（多意图并行）
- 生成 `intents[]`，允许多意图并存，不强制压缩成单意图。
- 每条意图都尽量给：`goal`、`confidence`、`executable`、`resolvedSlots`、`missingSlots`。
- 本阶段必须优先调用 tool 做能力探测，不可只靠记忆猜测：
  - 先调用 `list_skills_by_domain_segment` 获取候选能力清单（可按最可能的 `domainId/segmentId` 多次探测）。
  - 若候选仍不清晰，再调用 `invoke_skill` 获取关键能力细节（入参、约束、适用条件）后再落意图。
  - 对相关候选能力应逐个查看详情，不漏关键 skill；再进行意图拆解与计划。
- 输出中的 `skillId` / `selectedCapability.id` 等标识必须来自已查询到的 skill 详情，禁止凭空捏造。
- `intents[].domainId`、`segmentId` 与 `planningTasks[].skillSteps[].selectedCapability` 要与 tool 返回的能力上下文保持一致；不确定时降低置信度并走澄清。


#### 第三步：上下文锚点补齐（domain + segment + selectedCapability）
- 意图拆分应按 `system-module` 进行（对应 `planningTasks[].systemModuleId`）。
- 对可执行或接近可执行的任务步骤，补齐：
  - `domainId`
  - `segmentId`
  - `selectedCapability.id`
- 这些字段用于后续路由、能力收敛、执行节点透传。

#### 第四步：规划拆分（planningTasks）
- 输出 `planningTasks[]`，每个 task 对应一个可执行目标。
- 多个子任务按数组顺序串行执行：`task-1 -> task-2 -> ...`，不要并行假设。
- task 内通过 `skillSteps[]` 描述：候选能力、选中能力、参数状态、可执行性。
- `skillSteps[].disclosedCapabilityIds` 必须来自本轮 tool 查询结果；禁止凭空编造能力 id。
- `skillSteps[].selectedCapability` 必须基于已披露候选收敛得到；若未完成工具核验，不应标记 `executable=true`。
- 若可判断数据源，填写 `skillSteps[].dbClientKey`（如 `member`/`default`）；无法判断时可留空由执行层兜底。
- 每个可执行 step 的执行链路固定为两段：`invoke_skill` 取详情/约束并生成 SQL，再用 `sql_query` 执行该 SQL。
- 规划时必须体现步骤先后关系：当某个 capability 缺少参数，但这些参数可由另一个 capability 的结果补齐时，应先安排“前置 capability”执行，再执行当前 capability。
- 对依赖上游结果的 step：当前轮应将其标记为 `executable=false`，并在 `missingParams` 中明确缺失项；待前置 step 完成后再切换为可执行。
- `skillSteps[]` 的顺序应与实际执行顺序一致：先“产出依赖参数”的步骤，后“消费依赖参数”的步骤。
- 前一个子任务执行后产出的 `rows/tables` 会作为后续子任务可见上下文；后续 task 设计时可显式依赖这些结果。

#### 第五步：执行门闸判定
- 若任一关键任务缺参：`planPhase = "blocked"` 且 `needsClarification = true`。
- 若可执行：`planPhase = "ready"` 且至少一条 `planningTasks[].executable = true`。

#### 第六步：生成全局回答控制字段
- 填充 `replyLocale`、`clarificationQuestion`、`replySuggestion`。
- 用 `planPhase`（`draft` / `blocked` / `ready`）与 `needsClarification` 表达本轮是否先澄清、是否可执行；`planningTasks[].executable` 与 `skillSteps[].executable` 与之一致。

---

### 2) 每一步输出说明（字段级）

#### 2.1 意图层（`intents[]`）
- `intent`: 意图类型（按代码枚举）。
- `goal`: 当前子意图要完成的目标。
- `resolvedSlots` / `missingSlots`: 参数充足性依据。
- `domainId` + `segmentId`: 传递到下一环节的定位上下文。
- `selectedCapability.id`: 下一步可直接使用的能力入口锚点（位于 `planningTasks[].skillSteps[]`）。
- `executable` / `needsClarification`: 子意图级执行状态。

#### 2.2 规划层（`planningTasks[]`）
- `taskId`, `systemModuleId`, `goal`: 任务骨架。
- `skillSteps[]`: 从“候选能力”到“选中能力”的收敛过程。
- `selectedCapability.ownerSkillId`: 能力入口归属的 skill/guide id（用于日志定位与执行映射）。
- `requiredParams` / `providedParams` / `missingParams`: 参数完整性。
- `executionSkillId`: 当前 step 最终执行技能 id（如 `sql_query`），与 `selectedCapability.id`（能力入口）区分。
- `dbClientKey`: 当前 step 推荐的数据源连接键（如 `member` / `default`），供执行节点透传给 SQL 执行器。
- `expectedOutput`: 预期产出形态（`table|object|summary`）。

#### 2.3 全局控制层
- `planPhase`: `draft|blocked|ready`。
- `needsClarification` + `clarificationQuestion`: 本轮是否先追问。
- 缺参汇总落在 `planningTasks[].missingSlots` 与 `skillSteps[].missingParams`，合成侧据此生成澄清话术。

---

### 3) 专项描述（场景化规则）

#### 3.1 多意图场景
- 不要强制单意图。
- 可执行任务与缺参任务可并存，均保留在结果里。
- 多任务缺参时，各 `planningTasks` 上的 `missingSlots` / `skillSteps[].missingParams` 应去重且可汇总到根级 `clarificationQuestion`（可选）。

#### 3.2 能力披露与收敛场景
- 先给 `disclosedCapabilityIds`（候选），再给 `selectedCapability`（收敛）。
- 不确定时不要编造能力 id，走澄清路径更优。

#### 3.3 缺参与澄清场景
- 缺关键参数必须写 `missingSlots` / `missingParams`。
- `needsClarification=true` 时必须有可读的 `clarificationQuestion`。

#### 3.4 可执行场景
- 至少一个 task 明确 `executable=true`。
- 必须提供可落地入口：`selectedCapability.id`。

---

### 4) 返回结果描述（契约与标准）

#### 4.1 输出格式硬约束
- 只返回 **一个 JSON 对象**。
- 不输出 markdown / 代码块 / 解释文字。
- 只做意图识别与任务拆解，不执行真实业务查询（尤其不要在本阶段执行 SQL）。
- 必须可通过 `src/contracts/intentSchemas.ts` 的 `IntentResultSchema` 校验。

#### 4.2 最低合格标准
- `intents.length >= 1`
- `planningTasks.length >= 1`
- `planPhase` 与 `needsClarification` 语义一致
- 至少一条任务步骤包含可传递执行入口：`selectedCapability.id`（可执行场景）
- `planningTasks` 内缺参与 `planPhase` / `needsClarification` 一致

---

### 5) 返回 JSON 示例（最小可用）

```json
{
  "intents": [
    {
      "intent": "data_query",
      "goal": "查询会员积分账户与最近流水",
      "confidence": 0.87,
      "executable": true,
      "needsClarification": false,
      "resolvedSlots": {
        "vipIds": ["10001"]
      },
      "domainId": "data_query",
      "segmentId": "member",
      "missingSlots": []
    }
  ],
  "planPhase": "ready",
  "replyLocale": "zh",
  "planningTasks": [
    {
      "taskId": "task-1",
      "systemModuleId": "data_query",
      "goal": "完成会员积分查询",
      "resolvedSlots": {
        "vipIds": ["10001"]
      },
      "missingSlots": [],
      "executable": true,
      "skillSteps": [
        {
          "stepId": "step-1",
          "skillsDomainId": "data_query",
          "skillsSegmentId": "member",
          "disclosedCapabilityIds": [
            "member.points_account.by_vip_id",
            "member.points_account.ledger_recent"
          ],
          "selectedCapability": {
            "kind": "guide",
            "id": "member.points_account.ledger_recent",
            "ownerSkillId": "guide-member-account"
          },
          "requiredParams": ["vipIds"],
          "providedParams": {
            "vipIds": ["10001"]
          },
          "missingParams": [],
          "executable": true,
          "executionSkillId": "sql_query",
          "dbClientKey": "member",
          "expectedOutput": "table"
        }
      ],
      "expectedOutput": "table"
    }
  ],
  "needsClarification": false,
  "confidence": 0.87
}
```

### 6) 两步依赖链示例（先产参，再查询）

当后置能力依赖前置能力产出的参数时，`skillSteps` 应按执行顺序排列，并显式标注可执行性：

```json
{
  "planPhase": "ready",
  "planningTasks": [
    {
      "taskId": "task-lookup-and-query",
      "systemModuleId": "data_query",
      "goal": "先定位会员，再查询会员档案",
      "executable": true,
      "skillSteps": [
        {
          "stepId": "step-1",
          "skillsDomainId": "data_query",
          "skillsSegmentId": "member",
          "selectedCapability": {
            "kind": "guide",
            "id": "member.lookup.by_phone",
            "ownerSkillId": "guide-member-profile"
          },
          "requiredParams": ["phone"],
          "providedParams": { "phone": "13800000000" },
          "missingParams": [],
          "executable": true,
          "expectedOutput": "object"
        },
        {
          "stepId": "step-2",
          "skillsDomainId": "data_query",
          "skillsSegmentId": "member",
          "selectedCapability": {
            "kind": "guide",
            "id": "member.profile.by_user_id",
            "ownerSkillId": "guide-member-profile"
          },
          "requiredParams": ["vipIds"],
          "providedParams": {},
          "missingParams": ["vipIds"],
          "executable": false,
          "executionSkillId": "sql_query",
          "dbClientKey": "member",
          "expectedOutput": "table"
        }
      ]
    }
  ],
  "needsClarification": false
}
```

说明：
- `step-2` 当前不可执行是因为缺少 `vipIds`；该参数由 `step-1` 产出后再补齐。
- 当上游已产出并写回 `providedParams.vipIds` 后，应把 `step-2.executable` 更新为 `true` 再执行。
