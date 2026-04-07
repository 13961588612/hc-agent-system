---
id: member.points_account.ledger_recent
kind: guide
title: 会员积分流水（近期）
description: 已知会员内部编号（vipIds）时，查询最近积分流水。
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - points
  - ledger
params:
  required:
    - name: vipIds
      type: string[]
      description: 会员内部编号列表，非空，最多 10 个
execution:
  skillId: sql-query
  sqlTemplateRef: inline
  confirmBeforeRun: false
  minConfidence: 0.72
inputBrief:
  required:
    - name: vipIds
      caption: 会员内部编号列表
      type: string[]
      maxItems: 10
outputBrief:
  resultType: table
  resultPath: result.rows
  fields:
    - name: vipId
      caption: 会员编号
      type: string
      nullable: false
    - name: pointsDelta
      caption: 积分变动值
      type: number
      nullable: false
    - name: changeTime
      caption: 变动时间
      type: string
      nullable: false
    - name: reason
      caption: 变动原因
      type: string
      nullable: true
---

查询会员最近积分流水，按时间倒序返回。

## 传入字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `vipIds` | `string[]` | 是 | 会员内部编号列表，非空，最多 10 个 |

## 传输字段（给 `data-query`）

| 字段路径 | 说明 |
|------|------|
| `sqlQuery.sql` | 使用下方 SQL 模板并完成参数占位替换 |
| `sqlQuery.params` | 与 `vipIds` 等长的绑定参数数组 |
| `sqlQuery.dbClientKey` | 固定 `member` |
| `sqlQuery.label` | 固定 `member.points_account.ledger_recent` |
| `sqlQuery.purpose` | 固定 `member.points_account.ledger_recent` |

```sql
SELECT
  l.hyid AS vipId,
  l.jf AS pointsDelta,
  l.create_time AS changeTime,
  l.memo AS reason
FROM bfcrm8.hyk_jfmx l
WHERE l.hyid IN (/* N 个绑定占位符，N <= 10 */)
ORDER BY l.create_time DESC
```

## 字段字典

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `vipId` | `string` | 会员编号 | 否 | `"10001"` |
| `pointsDelta` | `number` | 本次积分变动值 | 否 | `120` |
| `changeTime` | `string` | 变动时间 | 否 | `"2026-04-01 10:20:00"` |
| `reason` | `string` | 变动原因 | 是 | `"消费返积分"` |

## 空结果与异常约定

- 空结果：返回 `resultType=table` 且 `rows=[]`，不抛错。
- 参数不合法：执行前拦截，不执行 SQL。
- 执行异常：返回错误摘要，由规划层决定澄清或重试。
