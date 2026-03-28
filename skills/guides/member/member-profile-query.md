---
id: guide-member-profile
kind: guide
title: 会员档案 个人信息 会员卡信息查询 生日变更查询
domain: data_query
segment: member
relatedSkillIds:
  - sql-query
tags:
  - member
  - profile
  - 个人信息
  - 会员卡
  - 生日
  - 变更记录
---

## 适用场景（总述）

用户意图包含以下**任意**典型表达时，可归为「会员档案 / 会员资料 / 个人信息 / 会员卡信息」类查询：

- 查询会员资料、查询会员档案、会员档案、会员卡信息、会员信息、个人资料、个人信息

**边界**：若用户明确要**积分流水、订单列表、优惠券**等，应路由到其它 Guide（与本档案主档查询区分）。**会员积分账户 / 当前积分 / 积分流水** → 见 **`guide-member-account`**（`member-account-query.md`）。

**快照 vs 变更记录**：用户只说「查会员档案/资料」且未提变更、生日历史时，优先 **`member.profile.by_*` 快照**；出现 **会员信息变更、会员生日、会员生日变更、生日修改记录** 等表述时，优先 **`member.profile.change_log`**（见下文）。歧义时可澄清或按产品默认。

---

## 推荐使用方式（可执行技能）

1. **执行入口**：主 Agent / 意图节点在披露本 Guide 后，由 **LLM 按下方能力规格生成参数化 SQL**，经编排注入 **`OrchestratorInput.sqlQuery` 或 `sqlQueries`**，由 DataQuery 子图调用 **`sql-query`** 执行。**禁止**把用户原文拼进 SQL，必须使用绑定参数。
2. **传输契约**（`contracts/types.ts`）：
   - **`sqlQuery`**：单条 `{ sql, params?, dbClientKey?, label?, purpose? }`。
   - **`sqlQueries`**：多条数组，顺序执行，结果为 **`DataQueryResult.dataType === "tables"`**（`tables[].name` 建议用能力 id 填 `label`）。与 `sqlQuery` 同时存在时，**非空 `sqlQueries` 优先**。单次最多 **10** 条，超出部分忽略，`meta.truncatedQueries` 为截断条数。
3. **数据源与连接键**：本 Guide 能力对应 **`dbClientKey: "member"`**（见 `config/databases.yaml`）。若 `member` 执行失败，DataQuery 可能对 **`member` 回退 `default`** 以便联调（见实现日志）。
4. **物理库**：会员主数据位于 Oracle 模式 **`bfcrm8`**（见各条 SQL）。

---

## 能力规格：`member.profile.*`

以下每条能力有稳定 **能力 id**，便于编排、日志与后续槽位映射（**槽位与 frontmatter 扩展可后补**）。

**写给 LLM 的阅读约定**

- **「触发」**：只描述 **用户会怎么说、想干什么**（自然语言），不出现库表名、列名。
- **「选用条件」**：在 **意图已判定为查会员档案（快照）** 的前提下，按 **已填槽位类型** 选哪一条能力（仍用业务词：会员编号、卡号、手机号）。
- **表名、列名**：只在 **SQL 模板** 与紧随其后的 **库表说明** 中出现，供生成参数化 SQL 时使用。

### 参数绑定约定（含 `by_*` 批量与 `change_log`）

- 输入在业务上可描述为 **`string[]`** 或数值 id 列表；**运行时**应对每个元素单独绑定，生成与数组长度一致（且 **≤10**）的占位符，例如 `IN (?, ?, ?)` 或 Oracle `IN (:1, :2, :3)`（以实际驱动为准）。
- **禁止**：把 `"1,2,3"` 或 `"'a','b'"` 整段拼进 SQL（有注入风险且难审计）。
- **校验**：非空、去重后长度 1～10；空数组视为非法输入，不应下发 SQL。

---

### `member.profile.by_user_id`

| 项 | 内容 |
|----|------|
| **能力 id** | `member.profile.by_user_id` |
| **数据源** | `member`（`bfcrm8`） |
| **触发** | 用户想查 **会员资料 / 档案 / 个人信息 / 持卡信息** 等（说法同上文「适用场景」） |
| **选用条件** | 上游已解析出 **会员内部编号**（系统侧会员 id，非卡号、非手机号），并填入槽位 **`vipIds`** |

**输入**

| 字段名 | 类型 | 必填 | 约束与说明 |
|--------|------|------|------------|
| `vipIds` | `string[]`（或数值 id 数组，序列化前一致即可） | 是 | 非空，最多 **10** 个；每个元素为 **会员内部编号** 的字符串形式，如 `"1"`, `"2"`（对应库表字段 **`hyid`**，见 SQL） |

**SQL 模板**（`IN` 子句须按 `vipIds.length` 展开为等量绑定占位符）

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
  AND a.hyid IN (/* 此处为 N 个绑定占位符，N = vipIds 个数，N ≤ 10 */)
```

> **库表说明**：主档 **`bfcrm8.hyk_hyxx`**（别名 `a`），顾客档案 **`bfcrm8.hyk_gkda`**（`b`），卡类型 **`hykdef`**（`c`），门店 **`mddy`**（`d`）。与历史写法 `a.gkid = b.gkid(+)` 等价：`hyk_gkda` 侧为左连接，其余为内连接。

**输出格式**：`table`

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号 |
| `memberCardNo` | 会员卡号 |
| `userName` | 会员名 |
| `cardTypeName` | 卡类型名称 |
| `mobile` | 手机号码 |
| `storeName` | 归属门店 |
| `registeTime` | 注册时间 |

---

### `member.profile.by_member_card_no`

| 项 | 内容 |
|----|------|
| **能力 id** | `member.profile.by_member_card_no` |
| **数据源** | `member`（`bfcrm8`） |
| **触发** | 用户想通过 **会员卡号**（实体卡/电子卡上的号码）查该会员的档案资料 |
| **选用条件** | 槽位 **`memberCardNos`** 已就绪（每条一个卡号） |

**输入**

| 字段名 | 类型 | 必填 | 约束与说明 |
|--------|------|------|------------|
| `memberCardNos` | `string[]` | 是 | 非空，最多 **10** 个；每个元素为一条 **会员卡号**，与库字段 **`hyk_no`** 对应；**参数绑定**，勿手写引号拼接进 SQL |

**SQL 模板**

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
  AND a.hyk_no IN (/* N 个绑定占位符，N ≤ 10，与 memberCardNos 一一对应 */)
```

**输出格式**：`table`（列定义与 `by_user_id` 相同）

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号 |
| `memberCardNo` | 会员卡号 |
| `userName` | 会员名 |
| `cardTypeName` | 卡类型名称 |
| `mobile` | 手机号码 |
| `storeName` | 归属门店 |
| `registeTime` | 注册时间 |

---

### `member.profile.by_mobile`

| 项 | 内容 |
|----|------|
| **能力 id** | `member.profile.by_mobile` |
| **数据源** | `member`（`bfcrm8`） |
| **触发** | 用户提供 **手机号码**，想查对应 **是谁、会员档案、持卡信息** |
| **选用条件** | 槽位 **`mobiles`** 已就绪（每条一个手机号，建议归一化后再绑定） |

**输入**

| 字段名 | 类型 | 必填 | 约束与说明 |
|--------|------|------|------------|
| `mobiles` | `string[]` | 是 | 非空，最多 **10** 个；每个元素为一个 **手机号** 字符串；**参数绑定**，禁止把多个号码拼成一段 SQL 字面量 |

**SQL 模板**

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
  AND b.sjhm IN (/* N 个绑定占位符，N ≤ 10，与 mobiles 一一对应 */)
```

> **库表说明**：手机号条件落在 **顾客档案表 `hyk_gkda`**（别名 `b`）的 **`sjhm`** 列；与会员卡主档 **`hyk_hyxx`**（`a`）按 `gkid` 关联。生成 SQL 时勿把「触发」里的自然语言与列名混为一谈——用户只说「手机号」，列名仅供写 WHERE 使用。

**输出格式**：`table`（列定义同上）

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号 |
| `memberCardNo` | 会员卡号 |
| `userName` | 会员名 |
| `cardTypeName` | 卡类型名称 |
| `mobile` | 手机号码 |
| `storeName` | 归属门店 |
| `registeTime` | 注册时间 |

---

### `member.profile.change_log`

会员**生日（档案）变更记录**；与上文快照查询结果列不同，为**历史流水表**。

| 项 | 内容 |
|----|------|
| **能力 id** | `member.profile.change_log` |
| **数据源** | `member`（`bfcrm8`） |
| **触发** | **优先**：会员 **生日改了几次、生日变更记录、档案变更历史、什么时候改过生日**；**兼用**：用户笼统说查档案，但澄清后确认为要 **历史变更** 而非当前快照（与上文「快照 vs 变更记录」一致） |
| **选用条件** | 已掌握 **会员内部编号** 列表，填入 **`vipIds`** |

**输入**

| 字段名 | 类型 | 必填 | 约束与说明 |
|--------|------|------|------------|
| `vipIds` | `number[]` 或 `string[]`（与 `by_user_id` 一致） | 是 | 非空，最多 **10** 个；每个元素为 **会员内部编号**（库字段 **`hyid`**）；须逐条绑定，禁止整段拼接 |

**SQL 模板**（`IN` 子句按 `vipIds.length` 展开为等量绑定占位符；表名以库为准）

```sql
SELECT
  r.hyid AS vipId,
  r.birthday AS birthday,
  TO_CHAR(r.create_time, 'yyyy-mm-dd') AS change_day
FROM bfcrm8.hyk_birthday_record r
WHERE r.hyid IN (/* N 个绑定占位符，N = vipIds 个数，N ≤ 10 */)
```

> **说明**：批量查询时结果为多行（多会员、多历史记录），输出中保留 **`vipId`** 以便区分会员；若业务表字段名非 `create_time` / `birthday`，以实际 DDL 为准替换。

**输出格式**：`table`

| 列名 | 含义 |
|------|------|
| `vipId` | 会员编号（批量查询时用于区分） |
| `birthday` | 更新后生日 |
| `change_day` | 更新日期 |

---

## 编排提示

- 按 **已解析槽位** 选能力：**会员内部编号** → `by_user_id`；**会员卡号** → `by_member_card_no`；**手机号** → `by_mobile`；**生日/档案变更历史**（且已有会员编号）→ `change_log`（`vipIds`）。
- 意图识别完成后，将本 Guide 中与所选能力对应的 **SQL 模板 + 绑定参数** 填入 **`sqlQuery` / `sqlQueries`**，再进入 DataQuery 子图；多能力可一条 `sqlQueries` 或多轮子任务。
- 若同时涉及积分、订单，应拆多次查询或 `executionPlan.steps`，勿在一个 SQL 里硬堆无关业务。

## 注意事项

- 本文件为 **SkillGuide**，不执行代码；**运行时 SQL 由 LLM 按本文生成**，经 **`sqlQuery`/`sqlQueries`** 交由 DataQuery → `sql-query` 执行。
- 部署后可追加或修改本目录 `.md`；运行时由 `GUIDES_DIR` / `skills/guides` 扫描（见 `skills/guides/README.md`）。
