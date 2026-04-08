---
id: member.points_account.by_vip_id
kind: guide
title: 会员积分账户快照（按会员编号）
description: 已知会员内部编号（vipId）时，查询积分账户快照。
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - points
  - 积分
params:
  required:
    - name: vipId
      type: string
      description: 会员内部编号，单个非空字符串
execution:
  skillId: sql-query
  sqlTemplateRef: inline
  confirmBeforeRun: false
  minConfidence: 0.72
inputBrief:
  required:
    - name: vipId
      caption: 会员内部编号
      type: string
outputBrief:
  resultType: table
  resultPath: result.rows
  fields:
    - name: vipId
      caption: 会员编号
      type: string
      nullable: false
    - name: memberCardNo
      caption: 会员卡号
      type: string
      nullable: true
    - name: totalPoints
      caption: 总积分
      type: number
      nullable: false
---

根据会员内部编号查询积分账户快照。

## 传入字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `vipId` | `string` | 是 | 会员内部编号，单个 |

## 传输字段（给 `data-query`）

| 字段路径 | 说明 |
|------|------|
| `sqlQuery.sql` | 使用下方 SQL 模板并完成参数占位替换 |
| `sqlQuery.params` | 单个绑定值，顺序与 SQL 中占位符一致（如 `[vipId]`） |
| `sqlQuery.dbClientKey` | 固定 `member` |
| `sqlQuery.label` | 固定 `member.points_account.by_vip_id` |
| `sqlQuery.purpose` | 固定 `member.points_account.by_vip_id` |

```sql
SELECT
  h.hyid AS vipId,
  b.hyk_no AS memberCardNo,
  nvl(sum(NVL(h.wcljf, 0)),0) AS totalPoints
FROM bfcrm8.hyk_mdjf h,bfcrm8.hyk_hyxx b
WHERE h.hyid = :1
  AND h.hyid = b.hyid
GROUP BY h.hyid,b.hyk_no
```

## 字段字典

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `vipId` | `string` | 会员编号 | 否 | `"10001"` |
| `memberCardNo` | `string` | 会员卡号 | 是 | `"88000001"` |
| `totalPoints` | `number` | 总积分/剩余积分 | 否 | `2350` |

## 空结果与异常约定

- 空结果：返回 `resultType=table` 且 `rows=[]`，不抛错。
- 参数不合法：执行前拦截，不执行 SQL。
- 执行异常：返回错误摘要，由规划层决定澄清或重试。
