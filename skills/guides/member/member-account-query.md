---
id: guide-member-account
kind: guide
title: 会员积分账户查询（当前积分/可用积分/积分流水）
description: 会员积分账户快照与最近流水查询；数据源 member（bfcrm8）。
domain: data_query
segment: member
relatedSkillIds:
  - sql_query
tags:
  - member
  - points
  - 积分
  - 积分账户
  - 积分余额

# 粗粒度主题（意图/披露）；细粒度见 capabilities[].id
skillTemplateId: member.points_account

# 单篇多能力：每条对应正文「能力 id」，可分别配置槽位与 execution（见 src/guides/types.ts）
capabilities:
  - id: member.points_account.by_vip_id
    description: 已知会员内部编号（hyid）时，查询积分账户快照。
    params:
      required:
        - name: vipIds
          type: string[]
          description: 会员内部编号列表，与 SQL 绑定一一对应，最多 10 个
    execution:
      skillId: sql_query
      sqlTemplateRef: inline
      confirmBeforeRun: false
      minConfidence: 0.72
  - id: member.points_account.ledger_recent
    description: 查询会员最近积分流水（按会员编号）。
    params:
      required:
        - name: vipIds
          type: string[]
          description: 会员内部编号列表，与 SQL 绑定一一对应，最多 10 个
    execution:
      skillId: sql_query
      sqlTemplateRef: inline
      confirmBeforeRun: false
      minConfidence: 0.72
---

## 适用场景（总述）

用户意图包含以下**任意**典型表达时，可归为「**会员积分账户**」类查询（与「档案资料」「储值/现金钱包」区分）：

- 积分多少、当前积分、可用积分、剩余积分、积分余额、卡上有多少分
- 查一下会员积分、积分账户、积分汇总

**边界**：

- **会员档案 / 个人资料 / 卡资料 / 生日** → **`guide-member-profile`**（`member.profile.*`）。
- **储值/现金余额/钱包（非积分）** → 若有单独 Guide 则路由至对应文档；勿与「积分分」混淆。
- **纯订单/优惠券** → 其它域 Guide。

---

## 推荐使用方式（可执行技能）

1. **执行入口**：披露本 Guide 后，由 **LLM 按下方能力生成参数化 SQL**；生成后由 **LLM 调用 `data-query`** 执行，并注意每项能力对应的数据源名称。
2. **传输契约**：`DataQuerySqlItem`（`sql`、`params`、`dbClientKey`、`label`、`purpose`）；多步使用 `sqlQueries`。

---

## 能力规格：`member.points_account.*`

稳定 **能力 id** 供 `label` / `purpose`、日志与后续槽位映射。

### 参数绑定约定

- `hyid` / 卡号等批量条件：**`IN (:1, :2, …)`**，每值单独绑定，**≤10**。
- **禁止** `"1,2,3"` 整段拼入 SQL。

---

### `member.points_account.by_vip_id`

| 项 | 内容 |
|----|------|
| **capability_id** | `member.points_account.by_vip_id` |
| **db_client_name** | `member`（`bfcrm8`） |
| **关联技能** | `sql_query` |
| **触发** | 已解析 **会员编号 `hyid`**，查**积分账户快照**（当前/可用/冻结等，以实际表为准） |

**输入**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `vipIds` | `string[]` | 是 | 非空，≤10；元素为 `hyid` |

**SQL 模板**

> **替换说明**：若积分在 **`hyk_hyxx`** 上为列（如 `jf`、`kyjf`、`djjf`），可用下列形态；若在 **`hyk_jfzh`** 等独立表，改为查该表并 JOIN `hyk_hyxx`。

```sql
SELECT
  h.hyid AS vipId,
  b.hyk_no AS memberCardNo,
  nvl(sum(NVL(h.wcljf, 0)),0) AS totalPoints
FROM bfcrm8.hyk_mdjf h,bfcrm8.hyk_hyxx b
WHERE h.hyid IN (/* N 个绑定占位符，N ≤ 10 */)
and h.hyid=b.hyid
group by h.hyid,b.hyk_no
```

**输出格式**：`table`

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号 |
| `memberCardNo` | 会员卡号 |
| `totalPoints` | 总积分/账面积分/剩余积分/积分余额 |

