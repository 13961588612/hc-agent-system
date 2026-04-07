---
id: member.profile.by_member_card_no
kind: guide
title: 会员档案查询（按会员卡号）
description: 已知会员卡号（memberCardNos）时，查询会员档案快照。
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - profile
  - card
params:
  required:
    - name: memberCardNos
      type: string[]
      description: 会员卡号列表，非空，最多 10 个
execution:
  skillId: sql-query
  sqlTemplateRef: inline
  confirmBeforeRun: false
  minConfidence: 0.72
inputBrief:
  required:
    - name: memberCardNos
      caption: 会员卡号列表
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
    - name: memberCardNo
      caption: 会员卡号
      type: string
      nullable: true
    - name: userName
      caption: 会员姓名
      type: string
      nullable: true
    - name: cardTypeName
      caption: 卡类型名称
      type: string
      nullable: true
    - name: mobile
      caption: 手机号
      type: string
      nullable: true
    - name: storeName
      caption: 归属门店
      type: string
      nullable: true
    - name: registeTime
      caption: 注册时间
      type: string
      nullable: true
---

按会员卡号查询会员档案快照。

## 传入字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `memberCardNos` | `string[]` | 是 | 会员卡号列表，非空，最多 10 个 |

## 传输字段（给 `data-query`）

| 字段路径 | 说明 |
|------|------|
| `sqlQuery.sql` | 使用下方 SQL 模板并完成参数占位替换 |
| `sqlQuery.params` | 与 `memberCardNos` 等长的绑定参数数组 |
| `sqlQuery.dbClientKey` | 固定 `member` |
| `sqlQuery.label` | 固定 `member.profile.by_member_card_no` |
| `sqlQuery.purpose` | 固定 `member.profile.by_member_card_no` |

```sql
SELECT
  a.hyid AS vipId,
  a.hyk_no AS memberCardNo,
  b.gk_name AS userName,
  c.hykname AS cardTypeName,
  b.sjhm AS mobile,
  d.mdmc AS storeName,
  a.djsj AS registeTime
FROM bfcrm8.hyk_hyxx a
LEFT JOIN bfcrm8.hyk_gkda b ON a.gkid = b.gkid
JOIN bfcrm8.hykdef c ON a.hyktype = c.hyktype
JOIN bfcrm8.mddy d ON a.mdid = d.mdid
WHERE a.status <> -1
  AND c.bj_bhxs = 1
  AND a.hyk_no IN (/* N 个绑定占位符，N <= 10 */)
```

## 字段字典

| 字段 | 类型 | 含义 | 可空 | 示例 |
|------|------|------|------|------|
| `vipId` | `string` | 会员编号 | 否 | `"10001"` |
| `memberCardNo` | `string` | 会员卡号 | 是 | `"88000001"` |
| `userName` | `string` | 会员姓名 | 是 | `"张三"` |
| `cardTypeName` | `string` | 卡类型名称 | 是 | `"金卡"` |
| `mobile` | `string` | 手机号 | 是 | `"13800000000"` |
| `storeName` | `string` | 归属门店 | 是 | `"南京路店"` |
| `registeTime` | `string` | 注册时间 | 是 | `"2024-05-12 09:00:00"` |

## 空结果与异常约定

- 空结果：返回 `resultType=table` 且 `rows=[]`，不抛错。
- 参数不合法：执行前拦截，不执行 SQL。
- 执行异常：返回错误摘要，由规划层决定澄清或重试。
