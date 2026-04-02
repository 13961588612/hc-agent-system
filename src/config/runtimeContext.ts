import { execFileSync } from "node:child_process";
import { getEnvConfig, type EnvConfig } from "./envConfig.js";

export interface RuntimeContext {
  /** 进程启动时的工作目录（通常为项目根目录） */
  workspaceDir: string;
  /** Git 仓库根目录；非 Git 项目或未安装 Git 时为 undefined */
  gitRootDir?: string;
  /** 进程启动时间戳（毫秒） */
  startedAtMs: number;
  /** 环境配置快照（来自 envConfig） */
  env: EnvConfig;
}

function detectGitRoot(workspaceDir: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const root = out.trim();
    return root || undefined;
  } catch {
    return undefined;
  }
}

let runtimeContext: RuntimeContext | null = null;

/**
 * 获取进程级运行时上下文（惰性初始化 + 缓存）。
 */
export function getRuntimeContext(): RuntimeContext {
  if (runtimeContext) return runtimeContext;
  const workspaceDir = process.cwd();
  runtimeContext = {
    workspaceDir,
    gitRootDir: detectGitRoot(workspaceDir),
    startedAtMs: Date.now(),
    env: getEnvConfig()
  };
  return runtimeContext;
}

/**
 * 仅用于测试：清理缓存，让下一次 getRuntimeContext 重新探测。
 */
export function resetRuntimeContextForTest(): void {
  runtimeContext = null;
}
