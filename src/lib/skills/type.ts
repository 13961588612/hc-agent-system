import z from "zod";
import type { EnvConfig } from "../../config/envConfig.js";
import { SystemDomainEntry, SystemSegmentEntry } from "../../config/systemConfig.js";
import { SkillGuideEntry } from "../guides/index.js";
import type { DbClient } from "../infra/dbClient.js";
import type { DbClientManager } from "../infra/dbClientManager.js";

/**
 * 技能执行时可注入的上下文。
 * 与 `docs/skills-dynamic-disclosure-spec.md` 中的 SkillContext 一致。
 *
 * **数据库解析优先级**：若同时存在 `dbClient`，优先使用；否则若有 {@link DbClientManager}，
 * 用 {@link dbClientKey}（默认 `default`）从管理器取客户端；再否则由技能内回退（如新建 `DummyDbClient`）。
 */
export interface SkillContext {
  /** 直接注入单个连接时优先使用 */
  dbClient?: DbClient;
  /** 多数据源时从管理器按名解析 */
  dbClientManager?: DbClientManager;
  /** 在 {@link dbClientManager} 中查找的名称，缺省为 `default` */
  dbClientKey?: string;
  env?: EnvConfig;
  threadId?: string;
  taskId?: string;
}

export const skillKindSchema = z.enum(["skill", "guide", "playbook"]);
export type skillKind = z.infer<typeof skillKindSchema>;

export interface SkillCapabilityBrief {
  id: string;
  description?: string;
}

/**
 * 可披露元数据（L1）：用于 Registry 检索、get-skills-info、向量索引等。
 * **不含** `run`，避免把实现细节塞进 prompt。
 *
 * @typeParam TInput - 与该技能 `run` 的入参类型对齐；具体技能上写 `SkillMeta<SqlSkillInput, …>` 可获得类型提示。
 * @typeParam TOutput - 与 `run` 的返回类型对齐。Registry / invoke-skill 等异构场景通常使用默认 `unknown`。
 *
 * **关于 `outputSchema`**：非必填。需要约定「典型返回形状」、生成工具文档或与编排校验衔接时再填；
 * 不填时以 `run` 实际返回值为准，Registry 不强制校验输出。
 */
export interface SkillMeta<TInput = unknown, TOutput = unknown> {
  /** 全局唯一技能 id，如 `sql-query`，用于注册与 invoke-skill */
  id: string;
  /** 给人看的短名称 */
  name: string;
  /** 一句话说明用途；建议 ≤100 字，供检索与模型选技能 */
  description: string;
  /**
   * 能力标签，用于**域内过滤、路由与粗粒度匹配**（非全文检索）。
   * 例：`["sql","database"]`、`["member","points"]`。
   */
  capabilities?: SkillCapabilityBrief[] ;
  /**
   * **示例问法/指令**，用于向量检索、相似问召回或与用户问题做匹配；可多条。
   * 例：`["查我最近订单","会员积分明细"]`。
   */
  examples?: string[];
  /** 第一层：顶层域，见 {@link SkillDomain} */
  domainId?: string;
  /**
   * 第二层：域内业务分段（可选）。与 `domainId` 组合使用，如：
   * `domainId: "data_query"` + `segmentId: "member"`。
   * 通用技能（`domainId: "core"`）通常无需填写。
   */
  segmentId?: string;
  /**
   * 入参结构描述（如 JSON Schema 子集），供工具调用前校验或生成表单；可选。
   * 与泛型 `TInput` 语义对应；运行时仍以 TS 类型与 `run` 为准。
   */
  inputSchema?: Record<string, unknown>;
  /**
   * 出参结构描述（如 JSON Schema 子集），供文档、类型提示或对返回做轻量校验；**可选**。
   * 与泛型 `TOutput` 语义对应。多数技能可先不填，由调用方按实际 `run` 返回值处理。
   */
  outputSchema?: Record<string, unknown>;

  kind: skillKind;

  skill?: SkillGuideEntry | unknown;
}

/**
 * 完整技能定义：元数据 + `run`。
 * 每个 `*Skill.ts` 应导出 `skillDef: SkillDef<…>`（或 `default`）供发现器注册。
 *
 * @typeParam TInput - 入参类型
 * @typeParam TOutput - 返回类型
 *
 * @example
 * `export const skillDef: SkillDef<SqlSkillInput, SqlQueryResult> = { id: "sql-query", …, run: async (input, ctx) => … }`
 */
export interface SkillDef<TInput = unknown, TOutput = unknown>
  extends SkillMeta<TInput, TOutput> {
  run: (input: TInput, context?: SkillContext) => Promise<TOutput>;
}

/**
 * 异构注册表、动态发现、invoke-skill 等场景下的**类型擦除**形态（不保留具体 TInput/TOutput）。
 */
export type AnySkillDef = SkillDef<unknown, unknown>;

/** 仅元数据、无 `run` 时的擦除形态（如 getDisclosureMeta 列表项） */
export type AnySkillMeta = SkillMeta<unknown, unknown>;