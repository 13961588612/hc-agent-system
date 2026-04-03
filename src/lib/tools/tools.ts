import { bashTool, runBash } from "./bashTool.js";
import { readFileTool, runFileRead, runFileWrite, writeFileTool } from "./fileTool.js";
import { runSqlQueryTool, sqlQueryTool } from "./sqlQueryTool.js";
import { SqlSkillInput } from "../skills/core/sqlQuerySkill.js";
import {
  getSkillDetailByIdTool,
  listSkillsByDomainSegmentTool,
  runGetSkillDetailByIdTool,
  runListSkillsByDomainSegmentTool
} from "./skillsQueryTools.js";

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
  list_skills_by_domain_segment: (kw) => runListSkillsByDomainSegmentTool(kw),
  get_skill_detail_by_id: (kw) => runGetSkillDetailByIdTool(kw),
};

/** 主智能体可用工具（含 task） */
export const allTools: Record<string, unknown> = {
    bash: bashTool,
    read_file: readFileTool,
    writeFile: writeFileTool,
    sql_query: sqlQueryTool,
    list_skills_by_domain_segment: listSkillsByDomainSegmentTool,
    get_skill_detail_by_id: getSkillDetailByIdTool,
}