import { bashTool, runBash } from "./bashTool.js";
import { readFileTool, runFileRead, runFileWrite, writeFileTool } from "./fileTool.js";
import { runSqlQueryTool, sqlQueryTool } from "./sqlQueryTool.js";
import { SqlSkillInput } from "../skills/sqlQuerySkill.js";
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
  readFile: (kw) => runFileRead(kw["path"] as string, kw["limit"] as number | undefined),
  writeFile: (kw) => runFileWrite(kw["path"] as string, kw["content"] as string),
  sqlQuery: (kw) => runSqlQueryTool(kw["sqlQueryInput"] as SqlSkillInput),
  listSkillsByDomainSegment: (kw) => runListSkillsByDomainSegmentTool(kw),
  getSkillDetailById: (kw) => runGetSkillDetailByIdTool(kw),
};

/** 主智能体可用工具（含 task） */
export const allTools: Record<string, unknown> = {
    bash: bashTool,
    readFile: readFileTool,
    writeFile: writeFileTool,
    sqlQuery: sqlQueryTool,
    listSkillsByDomainSegment: listSkillsByDomainSegmentTool,
    getSkillDetailById: getSkillDetailByIdTool,
}