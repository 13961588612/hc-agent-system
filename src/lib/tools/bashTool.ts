/**
 * Bash 终端执行：危险命令检测与 Git Bash 执行。
 */
import { exec } from "child_process";
import { promisify } from "util";
import z from "zod";
import { getRuntimeContext } from "../../config/runtimeContext.js";

const execAsync = promisify(exec);

const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const WORK_DIR = getRuntimeContext().workspaceDir;

/** 危险命令模式及对应说明 */
const DANGEROUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+(-[rf]+|-[rf]*\s+)\s*\/\s*$/, reason: "删除根目录 (rm -rf /)" },
  { pattern: /\brm\s+(-[rf]+|-[rf]*\s+).*\/\*/, reason: "递归删除根目录下文件" },
  { pattern: /\brm\s+(-[rf]+|-[rf]*\s+).*\/\s+/, reason: "递归删除根路径" },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|:\s*&\s*\}\s*;\s*:/, reason: "Fork 炸弹" },
  { pattern: /\bmkfs\b/, reason: "格式化磁盘" },
  { pattern: /\bdd\s+.*of=\/dev\/(sd|hd|nvme)/, reason: "dd 写入块设备" },
  { pattern: /\bchmod\s+(-R\s+)?[0-7]{3}\s+\//, reason: "修改根目录权限" },
  { pattern: /\|\s*(bash|sh|zsh)\s*$/, reason: "管道到 shell" },
  { pattern: /\|\s*(bash|sh|zsh)\s+-c/, reason: "管道到 shell 执行" },
  { pattern: />\s*\/dev\/(sd|hd|nvme)/, reason: "重定向写入块设备" },
  { pattern: /\bformat\b.*\/dev\//, reason: "格式化设备" },
  { pattern: /\bfdisk\s+\/dev\//, reason: "磁盘分区操作" },
];

/**
 * 判断命令是否包含危险操作
 * @returns [是否危险, 原因]
 */
function isDangerousCommand(command: string): [boolean, string] {
  const normalized = command.trim().replace(/\s+/g, " ");
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return [true, reason];
    }
  }
  return [false, ""];
}

export async function runBash(command: string): Promise<string> {
  const [dangerous, reason] = isDangerousCommand(command);
  if (dangerous) return `拒绝执行（危险命令）: ${reason}`;
  try {
    const { stdout, stderr } = await execAsync(command, {
      shell: GIT_BASH,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      cwd: WORK_DIR,
    });
    return stdout + (stderr ? `\n[stderr]: ${stderr}` : "");
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    return `错误: ${err.message ?? String(error)}\n${err.stderr ?? ""}`;
  }
}

export const bashTool = {
  name: "bash",
  description: "在终端执行 bash 命令，用于文件操作、运行脚本等",
  schema: z.object({
    command: z.string().describe("要执行的 bash 命令"),
  }),
};