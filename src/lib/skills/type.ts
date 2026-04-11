import z from "zod";
import { GuideEntry } from "../guides/index.js";


export interface SkillContext {
  dbClientKey?: string;
  threadId?: string;
  taskId?: string;
}

export const SkillKindSchema = z.enum(["skill", "guide", "playbook"]);

export type SkillKind = z.infer<typeof SkillKindSchema>;

export type SkillDetail =  GuideEntry | unknown;

export interface SkillCapabilityBrief {
  id: string;
  description?: string;
}

/** 目录/工具列表用的轻量技能摘要（不含 `run`、不含完整 guide 体） */
export interface SkillBriefInfo {
  id: string;
  name: string;
  description: string;

  moduleId?: string;

  domainId?: string;
  /** 区分可执行技能 vs Guide/Playbook */
  kind: SkillKind;

  capabilities?: SkillCapabilityBrief[];
  /** 入参一句话摘要（来自 Guide 的 inputBrief / params，供列表与 tool 快速扫读） */
  inputSummary?: string;
  /** 出参一句话摘要（来自 Guide 的 outputBrief） */
  outputSummary?: string;
}


export interface SkillMeta {
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
  moduleId?: string;
  /**
   * 第二层：域内业务分段（可选）。与 `domainId` 组合使用，如：
   * `domainId: "data_query"` + `segmentId: "member"`。
   * 通用技能（`domainId: "core"`）通常无需填写。
   */
  domainId?: string;
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

  kind: SkillKind;

  skill?: SkillDetail;
}
