# 根目录 `skills/`（SkillGuide 与编排说明）

本目录位于**仓库根**，与源码中的 **`src/skills/`（可执行技能）** 区分：

| 路径 | 用途 |
|------|------|
| **`src/skills/`** | TypeScript 实现的 **`SkillDef`**，含 `run`，随版本发布、构建进产物 |
| **`skills/`（此处）** | **SkillGuide**：Markdown 说明、编排提示；**不执行代码**，部署后可挂载卷或追加文件，无需重新编译 |

## 子目录

- **`guides/`** — 单篇使用说明（推荐格式见 [`guides/README.md`](guides/README.md)）
- **`playbooks/`** — 多步编排说明（纯文档，可选）

## 部署建议

- 生产环境可将 `skills/` 挂载为只读卷，由运维追加 Guide
- 可执行逻辑仍只放在 `src/skills/`，避免在部署目录执行任意脚本

## 运行时

- 代码：`src/guides/`（`discoverAndRegisterGuides`、启动时扫描本目录下 `guides/`）
- 环境变量 `GUIDES_DIR` 可覆盖默认 `skills/guides` 根路径

## 文档

- 设计说明：`docs/design-phase2-skills-disclosure.md` §2.5
- 规范：`docs/skills-dynamic-disclosure-spec.md` §3.3
