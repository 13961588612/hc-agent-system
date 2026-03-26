# `skills/guides/` — SkillGuide 文件约定

本目录存放 **SkillGuide**：教 Agent **何时、如何**使用可执行技能（如 `sql-query`），**本身不包含可执行逻辑**。

## 文件格式

每篇一个 `.md` 文件，建议 **YAML Frontmatter + Markdown 正文**。

### Frontmatter 常用字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 全局唯一，建议前缀 `guide-`，避免与可执行 `skillId` 冲突 |
| `kind` | 是 | 固定为 `guide` |
| `title` | 是 | 短标题 |
| `domain` | 否 | 与技能分层一致，如 `data_query` |
| `segment` | 否 | 与 `SkillSegment` 对齐，如 `member` |
| `relatedSkillIds` | 否 | 相关可执行技能 id（如 `sql-query`） |
| `tags` | 否 | 检索/分类用 |

### 正文

用自然语言写：触发话术、推荐步骤、参数说明、注意事项。**不要**写可执行代码块冒充技能；SQL 示例仅作说明。

## 子目录

可按业务域分子目录，例如 `member/`、`ecommerce/`。

## 运行时加载

- **实现**：`src/guides/guideRegistry.ts`（`registerGuide` / `getGuide` / `listGuides` / `listGuidesByDomain` / `listGuidesByTag`）、`src/guides/scanGuides.ts`（`discoverAndRegisterGuides`）。
- **启动**：`src/index.ts` 在编排前调用扫描，默认目录为 `<cwd>/skills/guides`。
- **环境变量**：`GUIDES_DIR` 可指向其它绝对或相对路径（部署挂载目录）。
