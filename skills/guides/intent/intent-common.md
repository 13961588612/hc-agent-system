---
id: intent-common
kind: guide
title: 通用意图识别与任务编排 Skill
description: 供 intentClassifyAgent 调用的统一意图识别 skill；要求返回可被 IntentResultSchema 校验通过的 JSON，包含 planningTasks 与 taskPlan。
domain: intent
segment: common
relatedSkillIds:
tags:
  - 意图
  - intent
  - planning
---


## Capability Spec: `intent.common.decompose-and-orchestrate`

### 用途

该 skill 专用于 `intentClassifyAgent` 的 LLM 推理阶段。  
输入是用户问题（可含最近对话），输出必须是**单个 JSON 对象**，供 `IntentResultSchema` 解析并驱动后续编排节点。

---

### 调用与输出约束（必须遵守）

1. **输出格式强约束**
   - 只返回 JSON 对象，不允许 markdown、代码块、解释文字。
   - 返回字段必须与 `src/contracts/intentSchemas.ts` 兼容，至少包含：  
     `intents`、`dominantIntent`、`planPhase`、`replyLocale`、`planningTasks`、`needsClarification`。

2. **多意图与任务拆分**
   - 可以同时存在多个意图，不要强行压成单意图。
   - `planningTasks` 按 system module 拆分（如 `data_query` / `data_analysis` / `knowledge_qa`）。
  - 每个任务建议提供 `skillSteps`；每个 step 应尽量给出 `selectedCapability.id` 作为后续执行锚点。

3. **缺参与可执行判定**
   - 若关键信息缺失，必须给 `missingSlots`，并设置 `needsClarification=true`。
   - 当需澄清时，`planPhase` 必须为 `"blocked"`，并给自然语言 `clarificationQuestion`。
   - 当可直接执行时，`planPhase` 设为 `"ready"`，且至少一个子任务 `executable=true`。

4. **data_query 专项约束**
   - 若存在可执行 `data_query` 子意图，需尽量补齐：
     - `dataQueryDomain`
     - `targetIntent`
     - `resolvedSlots`
   - 在 `planningTasks[].skillSteps[]` 里尽量提供：
     - `skillsDomainId` / `skillsSegmentId`
     - `disclosedSkillIds`
    - `selectedCapability: { kind, id }`
     - `requiredParams` / `providedParams` / `missingParams`

5. **语言与稳健性**
   - `replyLocale` 固定返回 `"zh"` / `"en"` / `"auto"` 之一。
   - 不确定时不要编造工具结果，优先返回可解释的 `clarify` 路径。

---

### 渐进式披露与子任务生成（新增必遵循）

> 目标：先“找得到可用能力”，再“定得下执行计划”，最后“产出可执行子任务清单”。

1. **阶段一：粗粒度披露（discover）**
   - 先按最可能的 `skillsDomainId + skillsSegmentId` 组合披露候选能力（1~3 组）。
   - 每组输出到 `taskPlan.domainSegmentRanking[]`，并给 `reason`。
   - 将候选能力 id 写入 `planningTasks[].skillSteps[].disclosedSkillIds`。

2. **阶段二：细粒度确认（resolve）**
   - 从候选能力中选 1 个最匹配条目，写入 `selectedCapability: { kind, id }`。
   - 依据该条目的参数要求补齐：
     - `requiredParams`
     - `providedParams`
     - `missingParams`
   - 只要存在关键缺参，该 step 与 task 的 `executable` 必须为 `false`。

3. **阶段三：生成子任务（plan）**
   - 每个 `planningTask` 至少包含一个 `skillStep`。
   - `subTasks[]` 与 `planningTasks[]` 一一映射：
     - `taskId` 对齐
     - `selectedCapability` 对齐
     - `required/provided/missing` 对齐
   - `plan[]` 必须是可落地动作（例如：检索能力详情、参数校验、调用 data_query）。

4. **阶段四：执行门闸（gate）**
   - 全部可执行：`planPhase="ready"` 且 `taskPlan.nextAction="execute"`。
   - 任一关键任务不可执行：`planPhase="blocked"` 且 `taskPlan.nextAction="clarify"`。
   - 可部分执行时，优先保证已就绪任务进入 `planningTasks`，缺参任务保留 `missingSlots` 与追问。

5. **字段一致性要求**
   - `targetIntent` 应优先等于主 `selectedCapability.id`（data_query 场景）。
   - `planningTasks[].resolvedSlots` 与 `intents[].resolvedSlots` 语义一致，允许补充但不应冲突。
   - `missingParamsSummary` 应是所有 `subTasks[].missingParams` 的去重并集。

---

### 返回 JSON 参考（与代码契约对齐）

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
      "dataQueryDomain": "member",
      "targetIntent": "member.points_account.ledger_recent",
      "missingSlots": []
    }
  ],
  "dominantIntent": "data_query",
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
      "expectedOutput": "table",
      "followUpActions": [
        {
          "type": "invoke_agent",
          "params": {
            "agentType": "data_query"
          }
        }
      ]
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
          "执行 data_query 并返回结果"
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

---

### 最低合格返回标准

- `intents.length >= 1`
- `planningTasks.length >= 1`
- `planPhase` 与 `needsClarification` 一致（需要澄清时必须 `blocked`）
- `data_query` 可执行时，至少一条意图带 `dataQueryDomain + targetIntent + resolvedSlots`
- `taskPlan.nextAction` 与当前状态一致（可执行为 `execute`，缺参为 `clarify`）

---

### Partial 场景标准示例（一个可执行 + 一个缺参）

```json
{
  "intents": [
    {
      "intent": "data_query",
      "goal": "查询会员积分账户与最近流水",
      "executable": true,
      "needsClarification": false,
      "resolvedSlots": {
        "vipIds": ["10001"]
      },
      "dataQueryDomain": "member",
      "targetIntent": "member.points_account.by_vip_id",
      "missingSlots": []
    },
    {
      "intent": "data_query",
      "goal": "查询会员生日变更历史",
      "executable": false,
      "needsClarification": true,
      "resolvedSlots": {},
      "dataQueryDomain": "member",
      "targetIntent": "member.profile.change_log",
      "missingSlots": ["vipIds"],
      "clarificationQuestion": "请提供要查询的会员编号（vipIds）。"
    }
  ],
  "dominantIntent": "data_query",
  "planPhase": "blocked",
  "replyLocale": "zh",
  "planningTasks": [
    {
      "taskId": "task-1",
      "systemModuleId": "data_query",
      "goal": "查询会员积分账户",
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
            "member.points_account.by_vip_id"
          ],
          "selectedCapability": {
            "kind": "guide",
            "id": "member.points_account.by_vip_id"
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
    },
    {
      "taskId": "task-2",
      "systemModuleId": "data_query",
      "goal": "查询会员生日变更历史",
      "resolvedSlots": {},
      "missingSlots": ["vipIds"],
      "clarificationQuestion": "请提供要查询的会员编号（vipIds）。",
      "executable": false,
      "skillSteps": [
        {
          "stepId": "step-1",
          "skillsDomainId": "data_query",
          "skillsSegmentId": "member",
          "disclosedSkillIds": [
            "member.profile.change_log"
          ],
          "selectedCapability": {
            "kind": "guide",
            "id": "member.profile.change_log"
          },
          "requiredParams": ["vipIds"],
          "providedParams": {},
          "missingParams": ["vipIds"],
          "executable": false,
          "expectedOutput": "table"
        }
      ],
      "expectedOutput": "table"
    }
  ],
  "needsClarification": true,
  "clarificationQuestion": "已可先执行积分账户查询；若要补充生日变更历史，请提供会员编号（vipIds）。",
  "taskPlan": {
    "domainSegmentRanking": [
      {
        "domain": "data_query",
        "segment": "member",
        "score": 0.84,
        "reason": "同属会员域，积分查询已满足参数，变更历史缺 vipIds"
      }
    ],
    "subTasks": [
      {
        "taskId": "task-1",
        "goal": "查询会员积分账户",
        "selectedCapability": {
          "kind": "guide",
          "id": "member.points_account.by_vip_id"
        },
        "executable": true,
        "requiredParams": ["vipIds"],
        "providedParams": {
          "vipIds": ["10001"]
        },
        "missingParams": [],
        "plan": [
          "读取能力详情",
          "组装参数化 SQL",
          "执行 data_query 并返回积分结果"
        ],
        "expectedOutput": "table"
      },
      {
        "taskId": "task-2",
        "goal": "查询会员生日变更历史",
        "selectedCapability": {
          "kind": "guide",
          "id": "member.profile.change_log"
        },
        "executable": false,
        "requiredParams": ["vipIds"],
        "providedParams": {},
        "missingParams": ["vipIds"],
        "expectedOutput": "table"
      }
    ],
    "missingParamsSummary": ["vipIds"],
    "nextAction": "clarify",
    "finalSummary": "当前可先执行 task-1；task-2 需补齐 vipIds 后再执行。"
  }
}
```
