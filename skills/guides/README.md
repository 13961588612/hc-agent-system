# `skills/guides/` — SkillGuide 文件约定（单文件单 skill）

本目录存放 **SkillGuide**：教 Agent 何时、如何使用可执行技能（如 `sql-query`），本身不包含可执行逻辑。

## 核心原则

- 一个 `.md` 只定义一个 guide skill。
- 不再支持 `capabilities` 数组，也不支持一个 skill 对应多个 capability。
- `id` 建议直接使用稳定能力标识（如 `member.profile.by_user_id`），便于规划与执行链路透传。

## 文件格式

每篇一个 `.md` 文件，使用 **YAML Frontmatter + Markdown 正文**。

### Frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 全局唯一 skill 标识（建议语义化、稳定） |
| `kind` | 是 | 固定为 `guide` |
| `title` | 是 | 短标题 |
| `description` | 否 | 披露与检索用短描述 |
| `domain` | 否 | 领域标识，如 `data_query` |
| `segment` | 否 | 业务分段，如 `member` |
| `relatedSkillIds` | 否 | 关联可执行技能（如 `sql-query`） |
| `tags` | 否 | 检索标签 |
| `params` | 否 | 槽位定义，支持 `required` / `optional` |
| `execution` | 否 | 执行配置（`skillId`、`minConfidence` 等） |
| `inputBrief` | 否 | 头部输入摘要（用于不读正文时快速规划） |
| `outputBrief` | 否 | 头部输出摘要（`resultType/resultPath/fields`） |

### 正文约定

- 正文可包含说明与一个 SQL 模板代码块（`sql` fenced block）。
- 编排层会读取正文中的首个 SQL 代码块作为模板。
- SQL 必须使用参数绑定占位，禁止拼接用户输入。
- 建议每个文档都包含：
  - `传入字段`：声明入口参数（字段名、类型、必填、约束）
  - `传输字段`：声明传给 `data-query` 的 `sqlQuery` 契约字段（`sql`/`params`/`dbClientKey`/`label`/`purpose`）
  - `执行后数据格式`：声明 `resultType`、结果路径与示例
  - `字段字典`：声明输出字段类型、可空性、含义
  - `规划可用字段`：明确下游参数映射关系
  - `空结果与异常约定`：统一规划分支行为

### 头部快速规划建议

为减少读取正文成本，建议在 frontmatter 增加：

- `inputBrief.required[]`：最小必填参数摘要（如 `name/caption/type/maxItems`）
- `outputBrief`：
  - `resultType`：如 `table|object|summary`
  - `resultPath`：建议统一 `result.rows`
  - `fields[]`：输出字段字典（`name/caption/type/nullable`）

`caption` 约定：

- 文档级使用 `title`；
- 字段级统一使用 `caption`（避免与文档级 `title` 混淆）；
- 推荐在 `inputBrief.required[]` 与 `outputBrief.fields[]` 中都提供 `caption`，便于 LLM 仅读取头部即理解业务含义。

## 子目录

可按业务域分子目录组织，例如 `member/`、`ecommerce/`。

## 运行时加载

- **实现**：`src/lib/guides/guideRegistry.ts`、`src/lib/guides/scanGuides.ts`。
- **启动**：启动阶段调用 `discoverAndRegisterGuides`，默认目录为 `<workspace>/skills/guides`。
- **环境变量**：`GUIDES_DIR` 可覆盖默认目录。
