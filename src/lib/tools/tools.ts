import { bashTool, runBash } from "./bashTool.js";
import { readFileTool, runFileRead, runFileWrite, writeFileTool } from "./fileTool.js";
import { runSqlQueryTool, sqlQueryTool } from "./sqlQueryTool.js";
import { SqlSkillInput } from "../skills/core/sqlQuerySkill.js";
import {
  findSkills,
  findSkillsTool,
  invokeSkillTool,
  runInvokeSkillTool,
} from "./skillsTools.js";

type ToolKwargs = Record<string, unknown>;

/** 工具名 -> 处理函数映射 */
export const TOOL_HANDLERS: Record<
  string,
  (kw: ToolKwargs) => Promise<string> | string
> = {
  bash: (kw) => runBash(kw["command"] as string),
  read_file: (kw) => runFileRead(kw["path"] as string, kw["limit"] as number | undefined),
  write_file: (kw) => runFileWrite(kw["path"] as string, kw["content"] as string),
  sql_query: (kw) => runSqlQueryTool(kw["sqlQueryInput"] as SqlSkillInput),
  find_skills: (kw) => findSkills(kw["domainId"] as string),
  invoke_skill: (kw) => runInvokeSkillTool(kw["skillId"] as string),
};

/** 主智能体可用工具（含 task） */
export const allTools: Record<string, unknown> = {
    bash: bashTool,
    read_file: readFileTool,
    write_file: writeFileTool,
    sql_query: sqlQueryTool,
    find_skills: findSkillsTool,
    invoke_skill: invokeSkillTool,
}