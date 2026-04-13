import { z } from "zod/v3";
import { SelectedSkillKindSchema } from "../../contracts/intentSchemas.js";
import {
  getIntentSeparateItemSchema,
  getIntentSeparateResultSchema,
} from "../separate/intentSeparateSchema.js";

/** 与 `buildIntentResultSchema` 内 followUpAction 对齐，供规划层复用 */
const FollowUpActionSchema = z.object({
  type: z.enum(["write_artifact", "reply_channel", "invoke_agent", "none"]).describe("后续动作类型"),
  params: z.record(z.string(), z.unknown()).optional().describe("后续动作参数")
}).describe("步骤/任务执行后的后续动作定义");

const OutputTypeSchema = z.string();

/**
 * 规划步骤（skill 链中的一步），语义对齐 IntentResult.planningTasks[].skillSteps[]。
 */
export const StepSchema = z.object({
  stepId: z.string().describe("步骤唯一标识"),
  skillsDomainId: z.string().describe("技能域 id"),
  disclosedSkillIds: z.array(z.string()).optional().describe("披露阶段返回的候选 skill id 列表"),
  selectedSkillId: z.string().optional().describe("当前步骤选中的 skill/guide id"),
  selectedSkillKind: SelectedSkillKindSchema.optional().describe("选中入口类型"),
  requiredParams: z.array(z.string()).optional().describe("步骤要求的参数名列表"),
  providedParams: z.record(z.string(), z.unknown()).optional().describe("当前已提供参数"),
  missingParams: z.array(z.string()).optional().describe("当前仍缺失参数名列表"),
  executable: z.boolean().optional().describe("当前步骤是否可执行"),
  executionSkillId: z.string().optional().describe("实际执行用技能 id"),
  dbClientKey: z.string().optional().describe("数据库连接键"),
  expectedOutput: OutputTypeSchema.optional().describe("预期输出格式"),
  followUpActions: z.array(FollowUpActionSchema).optional().describe("步骤完成后的后续动作")
}).describe("规划步骤（与 IntentResult.planningTasks[].skillSteps[] 对齐）");

/**
 * 单条规划任务：`PlanSchema.tasks` 中与 `intentSeparateResult.intents[separateIntentIndex]` 一一对应的一行。
 */
export const TaskSchema = z.object({
  taskId: z.string().describe("任务唯一标识"),
  intentId: z.string().describe("任务所属意图 id"),
  goal: z.string().describe("任务目标描述"),
  resolvedSlots: z.record(z.string(), z.unknown()).optional().describe("任务级已解析槽位"),
  missingSlots: z.array(z.string()).optional().describe("任务级缺失槽位"),
  clarificationQuestion: z.string().optional().describe("任务级澄清问题"),
  executable: z.boolean().optional().describe("任务是否可执行"),
  steps: z.array(StepSchema).optional().describe("任务下的执行步骤"),
  expectedOutput: OutputTypeSchema.optional().describe("任务预期输出格式"),
  followUpActions: z.array(FollowUpActionSchema).optional().describe("任务完成后的后续动作"),
  /** 对应 `intentSeparateResult.intents` 的下标（0-based） */
  separateIntentIndex: z.number().int().min(0).describe("对应 intentSeparateResult.intents 的下标"),
  /** 可选快照，便于校验与离线展示；若提供应与 `intents[separateIntentIndex]` 一致 */
  intent: z
    .lazy(() => getIntentSeparateItemSchema())
    .optional()
    .describe("可选：对应单条意图拆分项快照")

}).describe("单条子任务定义（对应原 planningTasks[] 中一行）");


/**
 * 基于阶段一 `intentSeparateResult` 的规划结构：
 * - 根级携带完整 `intentSeparateResult`
 * - `tasks.length` 须等于 `intents.length`，且每条任务的 `separateIntentIndex` 与下标 `0..n-1` 一一对应（无重复、无遗漏）
 */
export const PlanSchema = z
  .object({
    intentSeparateResult: z.lazy(() => getIntentSeparateResultSchema()),
    planVersion: z.string().optional().describe("规划结构版本，便于协议演进"),
    tasks: z.array(TaskSchema).min(0)
  })
  .superRefine((data, ctx) => {
    const n = data.intentSeparateResult.intents.length;
    if (data.tasks.length !== n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `tasks 条数（${data.tasks.length}）须与 intentSeparateResult.intents 条数（${n}）一致`
      });
      return;
    }
    const seen = new Set<number>();
    for (const t of data.tasks) {
      const idx = t.separateIntentIndex;
      if (idx < 0 || idx >= n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `separateIntentIndex=${idx} 超出 intents 范围 [0, ${n - 1}]`
        });
        continue;
      }
      if (seen.has(idx)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `重复的 separateIntentIndex=${idx}`
        });
      }
      seen.add(idx);
    }
    for (let i = 0; i < n; i++) {
      if (!seen.has(i)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `缺少 separateIntentIndex=${i} 对应的任务`
        });
      }
    }
  });

export type Step = z.infer<typeof StepSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
