/**
 * SkillGuide：仓库根目录 `skills/guides` 下递归扫描的 `.md` 说明类条目（非可执行）。
 * 见 `skills/guides/README.md`、`docs/skills-dynamic-disclosure-spec.md` §3.3、
 * `docs/design-milestone6-skillguide-slots.md`（里程碑 6 元数据）。
 */

/** Guide 分布式槽位：单参数定义 */
export interface GuideParamDef {
  name: string;
  type?: string;
  description?: string;
  examples?: unknown[];
}

/** `params` 根：required / optional 分组 */
export interface GuideParamsBlock {
  required?: GuideParamDef[];
  optional?: GuideParamDef[];
}

/** 与模板 SQL / sql-query 绑定的执行说明 */
export interface GuideExecution {
  /** 实际调用的可执行技能 id（如 `sql-query`） */
  skillId: string;
  /**
   * SQL 模板来源：如 `inline` 表示由正文/模板绑定生成；
   * 预留将来指向外部模板名或 artifacts 路径，由编排解析。
   */
  sqlTemplateRef?: string;
  /** 为 true 时执行前需用户确认（见里程碑 6 确认门） */
  confirmBeforeRun?: boolean;
  /** 选用该执行路径的最低置信度阈值；低于则不自动执行 */
  minConfidence?: number;
}

/**
 * 单篇 Guide 内的一条可执行能力（与正文「能力 id」对应）。
 * 查找键：优先 `queryTemplateId`，缺省可与 `id` 相同。
 */
export interface GuideCapabilityMeta {
  /** 稳定能力 id，如 `member.profile.by_user_id` */
  id: string;
  /** 短说明：披露列表、消歧、选用条件摘要（与正文「触发」可互补） */
  description?: string;
  /** 可选；与意图/模板路由对齐；未写时编排可用 `id` 参与匹配 */
  queryTemplateId?: string;
  params?: GuideParamsBlock;
  execution?: GuideExecution;
}

export interface SkillGuideMeta {
  id: string;
  kind: "guide";
  title: string;
  /** 短说明：披露/检索用，不必重复 `title` 全文 */
  description?: string;
  domain?: string;
  segment?: string;
  relatedSkillIds?: string[];
  tags?: string[];
  /**
   * 稳定查询模板 id，可与意图 `targetIntent` / 问数域主题映射。
   * 见 `docs/design-milestone6-skillguide-slots.md` §三。
   */
  queryTemplateId?: string;
  /** 分布式槽位；未配置时 Guide 仍可作为纯说明文档 */
  params?: GuideParamsBlock;
  /** 执行契约；未配置时不走自动模板执行路径 */
  execution?: GuideExecution;
  /**
   * 单文件多能力：每条可自带 `params` / `execution`。
   * 与顶层 `params` / `execution` 可并存：顶层作文件级默认，选中某能力后以该条为准（由编排侧合并策略决定）。
   */
  capabilities?: GuideCapabilityMeta[];
}

export interface SkillGuideEntry extends SkillGuideMeta {
  /** Markdown 正文（不含 frontmatter） */
  body: string;
  /** 解析来源的绝对或规范化路径 */
  filePath: string;
}
