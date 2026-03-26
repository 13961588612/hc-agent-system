大规模技能优化：从 1000 技能到高效架构

先说结论：

1000 个 Skills 直接放 skills/ 目录，绝对会炸。

- 启动慢

- 元数据太多，Agent 决策混乱

- 召回不准、容易选错技能

- Token 爆炸、成本飙升

但 1000 技能完全能做，只要用 分层 + 路由 + 向量检索 这套官方推荐的大规模方案。


---
一、为什么 1000 个 Skills 不能直接堆

DeepAgent 默认机制：

- 启动时把所有 skill 的 frontmatter 塞进 Prompt

- 1000 个描述 ≈ 10～30 万 Token

- 模型根本记不住，只会乱选、漏选、 hallucinate


---
二、大规模 Skills 官方标准方案：3 层架构

1）技能分类（第一层：路由）

把 1000 个技能分成 10～30 个大类：

- 电商查询

- 物流查询

- 财务报销

- 工单处理

- 数据统计

- 接口调用

- ...

每类只保留 1 个路由技能：

skill-route-ecommerce

skill-route-logistics

2）向量检索（第二层：召回）

把 1000 个技能的：

- name

- description

- example query

全部向量化，存入：

- Pinecone / Chroma / Qdrant / Milvus

用户一问 → 向量检索 → 召回 Top5～10 最相关技能

只把这 5～10 个给 Agent，不是 1000 个。

3）按需加载（第三层：执行）

Agent 选中某技能 → 再用 read_file 拉完整技能。


---
三、最终架构（能撑 1000～10000 技能）

用户问题
   ↓
路由 Agent（分类：电商/物流/财务...）
   ↓
向量检索（召回 Top5～10 技能）
   ↓
DeepAgent（只看这 5～10 个）
   ↓
选中 → 加载完整技能执行

优点：

- 上下文永远很小（≈10 技能）

- 速度快

- 准确率极高

- 可无限扩展


---
四、你现在就能用的最简落地版（不用改源码）

1. 把 1000 技能分文件夹

skills/
  00-router/           # 路由技能
  01-ecommerce/        # 100 个电商技能
  02-logistics/        # 150 个物流技能
  03-finance/
  ...

2. 做一个「技能检索器」skill

skills/00-skill-retriever/skill.md

作用：接收用户问题 → 召回相关技能描述。

3. 主 Agent 只加载：

- 路由技能

- 技能检索器技能

需要时，只动态加载命中的那几个。


---
五、关键规则（必看）

1. 技能描述越短越准

控制在 100 字以内

2. 必须加 example queries

向量检索靠这个吃饭

3. 同类技能放一起

不要乱

4. 不要让 Agent 一次看见 >20 个技能

超过必乱

Deep Agent 技能架构：分层与协同

我给你用最落地、能直接写进代码的方式讲清楚：

当技能需要「先查知识库 → 再处理」时，DeepAgent 到底怎么管技能。

核心结论（一句话）

把 「知识库查询」做成一个通用底层技能，

其他业务技能只写「业务逻辑」，

需要查知识时，业务技能调用知识库技能。


---
一、架构：两层技能体系

1. 底层通用技能（全局只有几个）

- skill-knowledge-base：知识库检索

- skill-sql-query：数据库查询

- skill-web-search：联网搜索

- skill-file-read-write：文件读写

这些不绑定业务，所有业务技能都能调用。

2. 上层业务技能（你那 1000 个）

- 订单查询

- 物流查询

- 售后处理

- 政策解读

- 产品说明

- 故障排查

每个业务技能只干一件事：决定要不要查知识 + 怎么用知识回答。


---
二、一个业务技能的标准结构（你直接复制用）

skills/order-query/skill.md

---
name: order-query
description: 查询用户订单信息、状态、物流
example: 我的订单到哪了？怎么还没发货？
allowed-tools: [call-skill]
---

# 订单查询技能流程
1. 提取用户问题里的关键信息：订单号、手机号、时间范围
2. **调用 skill-knowledge-base 检索订单相关知识**
3. 把检索到的知识 + 用户问题整理成回答
4. 如果信息不足，引导用户补充信息

然后 知识库技能 单独写：

skills/knowledge-base/skill.md

---
name: knowledge-base
description: 从企业知识库检索文档、政策、产品信息
allowed-tools: [vector-search]
---

# 使用方式
输入：用户问题
输出：Top5 相关知识片段


---
三、DeepAgent 里真正的执行流程（非常关键）

用户问：

“我买的手机为什么不保修？”

1. Agent 看到 1000 个技能的元描述

2. 匹配到：after-sales-warranty（售后保修）

3. Agent 决定：

→ 我需要调用知识库

4. Agent 执行：

call-skill(skill-knowledge-base, "手机不保修政策")

5. 知识库技能返回：

  - 保修条款

  - 例外情况

  - 处理流程

6. 业务技能用这些知识生成最终回答


---
四、这样做的 4 个巨大好处

1. 1000 个业务技能不会爆炸

每个都很小、很干净、不重复。

2. 知识库统一维护

不用每个技能都写一堆知识。

3. 渐进式披露依然生效

  - 只加载业务技能元数据

  - 需要时才加载完整技能

  - 需要知识时才去检索

4. 可无限扩展

加业务 = 加一个小 [skill.md](skill.md)

加知识 = 加文档，不用动技能


---
五、你最关心的：会不会太多？会不会乱？

不会。

- 1000 个业务技能 = 1000 个 tiny 技能（每个 1KB）

- 底层通用技能 = 3～5 个

- 知识库 = 外部向量库，不进 Prompt

Prompt 里永远只有：

- 几个通用技能描述

- 当前命中的 1～3 个业务技能

完全可控。


---
六、SkillGuide 与仓库根目录 `skills/`（说明类）

与 **`src/skills/` 里可执行 SkillDef** 不同，**SkillGuide** 只放「如何用技能」的说明（Markdown），**不执行 run**，适合**部署后动态追加**。

- 目录约定与格式：仓库根目录 [`skills/README.md`](../skills/README.md)、[`skills/guides/README.md`](../skills/guides/README.md)
- 设计说明：`design-phase2-skills-disclosure.md` §2.5、`skills-dynamic-disclosure-spec.md` §3.3
- Agent 建议流程：先读 Guide / 检索说明 → 再 `invoke-skill` 调 `sql-query` 等可执行技能


