---
id: member.profile.change_log
kind: guide
title: 会员生日变更记录查询
description: 已知会员内部编号（vipIds）时，查询会员生日变更历史。
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - profile
  - birthday
  - change-log
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
    - name: birthday
      caption: 变更后生日
      type: string
      nullable: true
    - name: change_day
      caption: 变更日期
      type: string
      nullable: false
---

查询会员生日变更记录（历史流水）。

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
| `sqlQuery.label` | 固定 `member.profile.change_log` |
| `sqlQuery.purpose` | 固定 `member.profile.change_log` |

```sql
SELECT
  r.hyid AS vipId,
  r.birthday AS birthday,
  TO_CHAR(r.create_time, 'yyyy-mm-dd') AS change_day
FROM bfcrm8.hyk_birthday_record r
WHERE r.hyid IN (/* N 个绑定占位符，N <= 10 */)
```

## 字段字典

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `vipId` | `string` | 会员编号 | 否 | `"10001"` |
| `birthday` | `string` | 变更后生日 | 是 | `"1990-01-02"` |
| `change_day` | `string` | 变更日期 | 否 | `"2026-03-28"` |

## 空结果与异常约定

- 空结果：返回 `resultType=table` 且 `rows=[]`，不抛错。
- 参数不合法：执行前拦截，不执行 SQL。
- 执行异常：返回错误摘要，由规划层决定澄清或重试。
