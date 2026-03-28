---
id: guide-member-account
kind: guide
title: 会员积分账户查询（当前积分/可用积分/积分流水）
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - points
  - 积分
  - 积分账户
  - 积分余额
---

## 适用场景（总述）

用户意图包含以下**任意**典型表达时，可归为「**会员积分账户**」类查询（与「档案资料」「储值/现金钱包」区分）：

- 积分多少、当前积分、可用积分、剩余积分、积分余额、卡上有多少分
- 查一下会员积分、积分账户、积分汇总
- 积分流水、积分变动记录、积分明细（与「当前余额快照」可同时需要时用 `sqlQueries`）

**边界**：

- **会员档案 / 个人资料 / 卡资料 / 生日** → **`guide-member-profile`**（`member.profile.*`）。
- **储值/现金余额/钱包（非积分）** → 若有单独 Guide 则路由至对应文档；勿与「积分分」混淆。
- **纯订单/优惠券** → 其它域 Guide。

---

## 推荐使用方式（可执行技能）

1. **执行入口**：披露本 Guide 后，由 **LLM 按下方能力生成参数化 SQL**，注入 **`OrchestratorInput.sqlQuery` 或 `sqlQueries`**，经 DataQuery → **`sql-query`**；**禁止**拼接用户原文。
2. **传输契约**：`DataQuerySqlItem`（`sql`、`params`、`dbClientKey`、`label`、`purpose`）；多步 **`sqlQueries`**。
3. **数据源**：**`dbClientKey: "member"`**；物理表示例 **Oracle `bfcrm8`**。
4. **表与字段**：下表为**示意**（常见为会员卡主档上的积分字段，或独立积分账户表），**须按贵司 DDL 替换**。

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
| **能力 id** | `member.points_account.by_vip_id` |
| **数据源** | `member`（`bfcrm8`） |
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
  h.hyk_no AS memberCardNo,
  NVL(h.jf, 0) AS totalPoints,
  NVL(h.kyjf, 0) AS availablePoints,
  NVL(h.djjf, 0) AS frozenPoints,
  h.jfxgsj AS pointsLastUpdateTime
FROM bfcrm8.hyk_hyxx h
WHERE h.hyid IN (/* N 个绑定占位符，N ≤ 10 */)
  AND NVL(h.status, 1) <> -1
```

**输出格式**：`table`

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号 |
| `memberCardNo` | 会员卡号 |
| `totalPoints` | 总积分/账面积分（以业务定义为准） |
| `availablePoints` | 可用积分 |
| `frozenPoints` | 冻结积分 |
| `pointsLastUpdateTime` | 积分最近更新时间（若有） |

---

### `member.points_account.by_member_card_no`

| 项 | 内容 |
|----|------|
| **能力 id** | `member.points_account.by_member_card_no` |
| **数据源** | `member`（`bfcrm8`） |
| **触发** | 已解析 **会员卡号 `hyk_no`**，查积分账户快照 |

**输入**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `memberCardNos` | `string[]` | 是 | 非空，≤10 |

**SQL 模板**

```sql
SELECT
  h.hyk_no AS memberCardNo,
  h.hyid AS vipId,
  NVL(h.jf, 0) AS totalPoints,
  NVL(h.kyjf, 0) AS availablePoints,
  NVL(h.djjf, 0) AS frozenPoints,
  h.jfxgsj AS pointsLastUpdateTime
FROM bfcrm8.hyk_hyxx h
WHERE h.hyk_no IN (/* N 个绑定占位符，N ≤ 10 */)
  AND NVL(h.status, 1) <> -1
```

**输出格式**：`table`（列含义同上）

---

### `member.points_account.ledger_recent`

| 项 | 内容 |
|----|------|
| **能力 id** | `member.points_account.ledger_recent` |
| **数据源** | `member`（`bfcrm8`） |
| **触发** | 用户要 **积分流水、积分明细、增减记录** |

**输入**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `vipIds` | `string[]` | 是 | 非空，≤10 |
| `limitRows` | `number` | 否 | 如 50，**绑定为参数** |

**SQL 模板**

> **替换说明**：流水表常见为 `hyk_jfmx`、`member_points` 等；列名请按 DDL 调整。以下为示意。

```sql
SELECT * FROM (
  SELECT
    m.hyid AS vipId,
    m.jlbh AS ledgerId,
    m.jfbg AS pointChange,
    m.jyyy AS reason,
    m.jysj AS txnTime,
    ROW_NUMBER() OVER (PARTITION BY m.hyid ORDER BY m.jysj DESC) AS rn
  FROM bfcrm8.hyk_jfmx m
  WHERE m.hyid IN (/* N 个绑定占位符 */)
) t
WHERE t.rn <= :limit
```

> `limit` 为**单独绑定参数**（如 `:limit` 在 Oracle 中与 `IN` 占位符序号错开时注意统一编号）。若仅有单会员也可简化为子查询 + `ROWNUM`。

**输出格式**：`table`

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号 |
| `ledgerId` | 流水号 |
| `pointChange` | 积分变动值（正增负减，以业务为准） |
| `reason` | 变动原因/类型说明 |
| `txnTime` | 发生时间 |

---

## 编排提示

- 「只要当前积分」→ `member.points_account.by_*`；「还要最近流水」→ **`sqlQueries`** 先快照后流水，或单条 SQL 由产品决定是否合并。
- 与 **档案** 组合：一条 `guide-member-profile` 能力 + 一条本 Guide 能力。
- `label` / `purpose` 建议与能力 id 一致。

## 注意事项

- 本文件为 **SkillGuide**；**可执行 SQL 由 LLM 按本文生成**，经 **`sqlQuery` / `sqlQueries`** 执行。
- **`hyk_hyxx` 上积分列名、`hyk_jfmx` 是否存在**以真实库为准，投产前务必替换。
