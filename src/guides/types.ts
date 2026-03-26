/**
 * SkillGuide：仓库根目录 `skills/guides` 下递归扫描的 `.md` 说明类条目（非可执行）。
 * 见 `skills/guides/README.md` 与 `docs/skills-dynamic-disclosure-spec.md` §3.3。
 */
export interface SkillGuideMeta {
  id: string;
  kind: "guide";
  title: string;
  domain?: string;
  segment?: string;
  relatedSkillIds?: string[];
  tags?: string[];
}

export interface SkillGuideEntry extends SkillGuideMeta {
  /** Markdown 正文（不含 frontmatter） */
  body: string;
  /** 解析来源的绝对或规范化路径 */
  filePath: string;
}
