---
id: intent-common
kind: guide
title: 通用意图拆分与执行编排规则
description: 通用意图拆分与编排指南：先基于 domain+segment 检索能力并查看详情，再校验必填参数，输出可执行子任务计划或缺参清单并统一汇总返回。
domain: intent
segment : common
relatedSkillIds:
tags:
  - 意图
---


## Capability Spec: `itent.common.decompose-and-orchestrate`

### 目标

将用户请求拆分为多个可执行子任务；在拆分前先基于系统可用能力做匹配，再形成最终计划。

---

### 操作规则（必须遵守）

1. **先检索能力，再拆任务**
   - 先调用 `listSkillsByDomainSegment(domain, segment)`，在候选 domain + segment 组合下获取可执行技能与 Guide/Playbook 列表。
   - 至少比较 1~3 组最可能的 `domain + segment`，按相关性排序。
   - 不允许在未看候选能力前直接拍脑袋拆分任务。

2. **先粗筛，后精筛**
   - 粗筛：根据用户目标、关键词、实体（如会员号/手机号/时间范围）评估 `domain + segment` 匹配度。
   - 精筛：对粗筛 TopN 项逐条调用 `getSkillDetailById(id)` 查看详情（skill 或 guide）。
   - 精筛后才能最终确定每个子任务的能力 id 与执行路径。

3. **参数校验优先于执行**
   - 若详情包含必填参数（如 `params.required`），必须逐项校验。
   - 能从用户输入、上下文或已解析槽位补齐则补齐；不能补齐则标记缺参，不可执行。
   - 禁止在必填参数缺失时输出“可执行”结论。

4. **任务拆分原则**
   - 一个子任务只做一件事（单一能力目标），避免把多个能力混在同一 SQL / 同一工具调用里。
   - 子任务之间要有依赖顺序（如先查主档，再查变更流水）。
   - 对并行可执行的子任务，明确标注可并行。

5. **执行计划粒度**
   - 对每个可执行子任务，给出可落地步骤：
     1) 选用能力（`skill/guide` + `id`）
     2) 输入参数与来源
     3) 校验规则（类型、必填、数量上限）
     4) 执行动作（调用 skill / 读取 guide 能力）
     5) 预期输出（表格/对象/摘要）
   - 不可执行子任务必须返回缺失参数清单与建议追问。

6. **统一汇总返回**
   - 最终结果必须一次性整合返回，包含：
     - 意图结论（主意图 + 候选 domain/segment）
     - 子任务列表（可执行 / 不可执行）
     - 每个可执行子任务的详细执行计划
     - 每个不可执行子任务的缺失参数
     - 总体下一步建议（立即执行或先澄清）

---

### 推荐输出结构（模板）

```json
{
  "primaryIntent": "string",
  "domainSegmentRanking": [
    {
      "domain": "string",
      "segment": "string",
      "score": 0.0,
      "reason": "string"
    }
  ],
  "subTasks": [
    {
      "taskId": "task-1",
      "goal": "string",
      "selectedEntry": {
        "kind": "skill|guide",
        "id": "string"
      },
      "executable": true,
      "requiredParams": ["..."],
      "providedParams": {},
      "missingParams": [],
      "plan": [
        "步骤1 ...",
        "步骤2 ..."
      ],
      "expectedOutput": "table|object|summary"
    }
  ],
  "missingParamsSummary": [],
  "nextAction": "execute|clarify",
  "finalSummary": "string"
}
```

---

### 约束

- 先 `listSkillsByDomainSegment`，再 `getSkillDetailById`，最后才做拆分与定案。
- 任何“执行计划”都必须绑定具体 `id`，不能只写泛化描述。
- 若无匹配能力，明确返回 `nextAction=clarify`，并给出最小追问集合。
