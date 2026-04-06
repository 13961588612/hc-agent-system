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

#### 第三步：上下文锚点补齐（domain + segment + entry）
- 对可执行或接近可执行的意图，补齐：
  - `domainId`
  - `segmentId`
  - `targetEntryId`
- 这些字段用于后续路由、能力收敛、执行节点透传。

#### 第四步：规划拆分（planningTasks）
- 输出 `planningTasks[]`，每个 task 对应一个可执行目标。
- task 内通过 `skillSteps[]` 描述：候选能力、选中能力、参数状态、可执行性。

#### 第五步：执行门闸判定
- 若任一关键任务缺参：`planPhase = "blocked"` 且 `needsClarification = true`。
- 若可执行：`planPhase = "ready"` 且至少一条 `planningTasks[].executable = true`。

#### 第六步：生成全局回答控制字段
- 填充 `replyLocale`、`clarificationQuestion`、`replySuggestion`。
- 用 `taskPlan.nextAction` 给出本轮下一动作：`execute` 或 `clarify`。

---

### 2) 每一步输出说明（字段级）

#### 2.1 意图层（`intents[]`）
- `intent`: 意图类型（按代码枚举）。
- `goal`: 当前子意图要完成的目标。
- `resolvedSlots` / `missingSlots`: 参数充足性依据。
- `domainId` + `segmentId`: 传递到下一环节的定位上下文。
- `targetEntryId`: 下一步可直接使用的能力入口锚点。
- `executable` / `needsClarification`: 子意图级执行状态。

#### 2.2 规划层（`planningTasks[]`）
- `taskId`, `systemModuleId`, `goal`: 任务骨架。
- `skillSteps[]`: 从“候选能力”到“选中能力”的收敛过程。
- `requiredParams` / `providedParams` / `missingParams`: 参数完整性。
- `expectedOutput`: 预期产出形态（`table|object|summary`）。

#### 2.3 全局控制层
- `planPhase`: `draft|blocked|ready`。
- `needsClarification` + `clarificationQuestion`: 本轮是否先追问。
- `taskPlan.nextAction`: 与当前状态一致（`execute` 或 `clarify`）。

---

### 3) 专项描述（场景化规则）

#### 3.1 多意图场景
- 不要强制单意图。
- 可执行任务与缺参任务可并存，均保留在结果里。
- `taskPlan.missingParamsSummary` 需汇总缺参并去重。

#### 3.2 能力披露与收敛场景
- 先给 `disclosedSkillIds`（候选），再给 `selectedCapability`（收敛）。
- 不确定时不要编造能力 id，走澄清路径更优。

#### 3.3 缺参与澄清场景
- 缺关键参数必须写 `missingSlots` / `missingParams`。
- `needsClarification=true` 时必须有可读的 `clarificationQuestion`。

#### 3.4 可执行场景
- 至少一个 task 明确 `executable=true`。
- 必须提供可落地入口：`targetEntryId` 或 `selectedCapability.id`。

---

### 4) 返回结果描述（契约与标准）

#### 4.1 输出格式硬约束
- 只返回 **一个 JSON 对象**。
- 不输出 markdown / 代码块 / 解释文字。
- 必须可通过 `src/contracts/intentSchemas.ts` 的 `IntentResultSchema` 校验。

#### 4.2 最低合格标准
- `intents.length >= 1`
- `planningTasks.length >= 1`
- `planPhase` 与 `needsClarification` 语义一致
- 至少一条意图包含可传递上下文：`domainId + segmentId + targetEntryId`（可执行场景）
- `taskPlan.nextAction` 与当前状态一致

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
      "targetEntryId": "member.points_account.ledger_recent",
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
          "disclosedSkillIds": [
            "member.points_account.by_vip_id",
            "member.points_account.ledger_recent"
          ],
          "selectedCapability": {
            "kind": "guide",
            "id": "member.points_account.ledger_recent"
          },
          "requiredParams": ["vipIds"],
          "providedParams": {
            "vipIds": ["10001"]
          },
          "missingParams": [],
          "executable": true,
          "expectedOutput": "table"
        }
      ],
      "expectedOutput": "table"
    }
  ],
  "needsClarification": false,
  "confidence": 0.87,
  "taskPlan": {
    "domainSegmentRanking": [
      {
        "domain": "data_query",
        "segment": "member",
        "score": 0.87,
        "reason": "命中会员积分与流水关键词，且槽位可用"
      }
    ],
    "subTasks": [
      {
        "taskId": "task-1",
        "goal": "完成会员积分查询",
        "selectedCapability": {
          "kind": "guide",
          "id": "member.points_account.ledger_recent"
        },
        "executable": true,
        "requiredParams": ["vipIds"],
        "providedParams": {
          "vipIds": ["10001"]
        },
        "missingParams": [],
        "plan": [
          "读取能力定义",
          "组装参数化 SQL",
          "调用执行节点并返回结果"
        ],
        "expectedOutput": "table"
      }
    ],
    "missingParamsSummary": [],
    "nextAction": "execute",
    "finalSummary": "参数齐全，可直接执行。"
  }
}
```
