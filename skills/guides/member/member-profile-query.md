---
id: guide-member-profile
kind: guide
title: 会员档案与个人信息查询
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - profile
  - 个人信息
---

## 适用场景

用户意图包含以下**任意**典型表达时，可归为「会员档案 / 会员资料 / 个人信息」类查询（需在子图路由中与关键词匹配）：

- 会员资料、会员档案、会员信息、个人资料、个人信息
- 会员等级、注册信息（若业务将「档案」与「积分」拆分，可再拆 Guide）

## 推荐使用方式（可执行技能）

1. **执行入口**：优先通过可执行技能 **`sql-query`**（或未来专用 `member-profile-query`）访问数据库，使用**参数化 SQL**，避免拼接用户原文。
2. **上下文**：`SkillContext` 中应携带 `userId`（或业务侧会员 id）；若使用 `DbClientManager`，按环境选择 `dbClientKey`（如 `default`）。
3. **Demo 环境**：当前 `DummyDbClient` 对包含 `member_points` 等 SQL 片段有示例数据；真实库需替换为真实表与字段。

## 编排提示

- 若用户仅问「档案」且未涉及**积分/订单**，优先单表查询会员主档，避免无关 JOIN。
- 若同时涉及「订单」「积分」，可分步查询或拆多步执行计划（见 DataQuery `executionPlan.steps`）。

## 注意事项

- 本文件为 **SkillGuide**，**不执行**任何代码；实际查询由 `src/skills/` 中可执行技能实现。
- 部署后可在本目录追加或修改 `.md`，无需重新编译应用（待 GuideRegistry 接入后生效于运行时检索）。
