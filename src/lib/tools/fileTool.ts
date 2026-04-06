/**
 * 工作区内文件读写与编辑（路径限制在 cwd 下）。
 */
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { getRuntimeContext } from "../../config/runtimeContext.js";

const WORK_DIR = getRuntimeContext().workspaceDir;

function safePath(p: string): string {
  const workDir = path.resolve(WORK_DIR);
  const resolved = path.resolve(workDir, p);
  const relative = path.relative(workDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

export async function runFileRead(filePath: string, limit?: number): Promise<string> {
  const content = await fs.readFile(safePath(filePath), "utf8");
  if (limit != null) return content.slice(0, limit);
  return content;
}

export async function runFileWrite(filePath: string, content: string): Promise<string> {
  await fs.writeFile(safePath(filePath), content);
  return "文件写入成功";
}


export const readFileTool = {
  name: "read_file",
  description: "读取文件内容",
  schema: z.object({
    path: z.string().describe("要读取的文件路径"),
    limit: z.number().describe("要读取的文件内容长度").optional(),
  }),
};

export const writeFileTool = {
  name: "write_file",
  description: "写入文件内容",
  schema: z.object({
    path: z.string().describe("要写入的文件路径"),
    content: z.string().describe("要写入的文件内容"),
  }),
};
