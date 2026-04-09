import { z } from "zod/v3";
import { SelectedSkillKindSchema } from "../../contracts/intentSchemas.js";
import {
  IntentSeparateItemSchema,
  IntentSeparateResultSchema,
  type IntentSeparateResult
} from "../separate/intentSeparateSchema.js";

/** 与 `buildIntentResultSchema` 内 followUpAction 对齐，供规划层复用 */
const FollowUpActionSchema = z.object({
  type: z.enum(["write_artifact", "reply_channel", "invoke_agent", "none"]),
  params: z.record(z.string(), z.unknown()).optional()
});

const OutputTypeSchema = z.string();

/**
 * 规划步骤（skill 链中的一步），语义对齐 IntentResult.planningTasks[].skillSteps[]。
 */
export const PlanSkillStepSchema = z.object({
  stepId: z.string(),
  skillsDomainId: z.string(),
  skillsSegmentId: z.string().optional(),
  disclosedSkillIds: z.array(z.string()).optional(),
  selectedSkillId: z.string().optional(),
  selectedSkillKind: SelectedSkillKindSchema.optional(),
  requiredParams: z.array(z.string()).optional(),
  providedParams: z.record(z.string(), z.unknown()).optional(),
  missingParams: z.array(z.string()).optional(),
  executable: z.boolean().optional(),
  executionSkillId: z.string().optional(),
  dbClientKey: z.string().optional(),
  expectedOutput: OutputTypeSchema.optional(),
  followUpActions: z.array(FollowUpActionSchema).optional()
});

/**
 * 单条「子任务」：对应原扁平 `planningTasks[]` 中的一行；
 * 多个子任务挂在同一 {@link PlanGroupSchema} 下，表示同一 `intentSeparateItem` 拆出的多步/多模块工作。
 */
export const PlanSubTaskSchema = z.object({
  taskId: z.string(),
  systemModuleId: z.string(),
  goal: z.string(),
  resolvedSlots: z.record(z.string(), z.unknown()).optional(),
  missingSlots: z.array(z.string()).optional(),
  clarificationQuestion: z.string().optional(),
  executable: z.boolean().optional(),
  skillSteps: z.array(PlanSkillStepSchema).optional(),
  expectedOutput: OutputTypeSchema.optional(),
  followUpActions: z.array(FollowUpActionSchema).optional()
});

/**
 * 一个 intentSeparate 子意图对应一个「任务组」：
 * - 与 `intentSeparateResult.intents[i]` 一一对应（通过 `separateItemIndex`）
 * - `subTasks` 为该子意图下的多条执行单元（原模型中多条 planning task）
 */
export const PlanGroupSchema = z.object({
  /** 对应 `intentSeparateResult.intents` 的下标（0-based） */
  separateItemIndex: z.number().int().min(0),
  /** 可选快照，便于校验与离线展示；若提供应与 `intents[separateItemIndex]` 一致 */
  intentItem: IntentSeparateItemSchema.optional(),
  /** 该子意图下的多条子任务，至少一条 */
  subTasks: z.array(PlanSubTaskSchema).min(1)
});

/**
 * 基于阶段一 `intentSeparateResult` 的规划结构：
 * - 根级携带完整 `intentSeparateResult`
 * - `groups.length` 应等于 `intents.length`，且每组下可有多个 `subTasks`
 */
export const PlanSchema = z
  .object({
    intentSeparateResult: IntentSeparateResultSchema,
    planVersion: z.string().optional().describe("规划结构版本，便于协议演进"),
    groups: z.array(PlanGroupSchema).min(1)
  })
  .superRefine((data, ctx) => {
    const n = data.intentSeparateResult.intents.length;
    if (data.groups.length !== n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `groups 条数（${data.groups.length}）须与 intentSeparateResult.intents 条数（${n}）一致`
      });
      return;
    }
    const seen = new Set<number>();
    for (const g of data.groups) {
      if (g.separateItemIndex < 0 || g.separateItemIndex >= n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `separateItemIndex=${g.separateItemIndex} 超出 intents 范围 [0, ${n - 1}]`
        });
      }
      if (seen.has(g.separateItemIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `重复的 separateItemIndex=${g.separateItemIndex}`
        });
      }
      seen.add(g.separateItemIndex);
    }
    for (let i = 0; i < n; i++) {
      if (!seen.has(i)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `缺少 separateItemIndex=${i} 对应的任务组`
        });
      }
    }
  });

export type PlanSkillStep = z.infer<typeof PlanSkillStepSchema>;
export type PlanSubTask = z.infer<typeof PlanSubTaskSchema>;
export type PlanGroup = z.infer<typeof PlanGroupSchema>;
export type Plan = z.infer<typeof PlanSchema>;

/**
 * 将嵌套 {@link Plan} 展平为与 `IntentResult.planningTasks` 同形的列表（仅结构对齐，不合并 intents）。
 * `taskId` 默认编码为 `p{组索引}-t{组内序号}`，避免跨组碰撞。
 */
export function flattenPlanToPlanningTasks(plan: Plan): PlanSubTask[] {
  const out: PlanSubTask[] = [];
  const sorted = [...plan.groups].sort((a, b) => a.separateItemIndex - b.separateItemIndex);
  for (let gi = 0; gi < sorted.length; gi++) {
    const g = sorted[gi]!;
    g.subTasks.forEach((t, ti) => {
      const id = t.taskId?.trim() ? t.taskId : `p${g.separateItemIndex}-t${ti}`;
      out.push({ ...t, taskId: id });
    });
  }
  return out;
}

/**
 * 由 `intentSeparateResult` 生成占位 {@link Plan}（每组一条占位 subTask，供后续规划 LLM 或程序化逻辑覆盖）。
 */
export function scaffoldPlanFromIntentSeparate(
  intentSeparateResult: IntentSeparateResult
): Plan {
  const groups: PlanGroup[] = intentSeparateResult.intents.map((intentItem, separateItemIndex) => ({
    separateItemIndex,
    intentItem,
    subTasks: [
      {
        taskId: `p${separateItemIndex}-t0`,
        systemModuleId: intentItem.intent,
        goal: intentItem.goal ?? intentItem.semanticTaskBrief,
        resolvedSlots: intentItem.resolvedSlots,
        executable: undefined,
        skillSteps: undefined
      }
    ]
  }));
  return {
    intentSeparateResult,
    planVersion: "1",
    groups
  };
}
