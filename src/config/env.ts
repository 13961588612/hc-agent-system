import dotenv from "dotenv";
import path from "path";

// 加载 .env 和 .env.local（local 覆盖，用于本地开发）
dotenv.config(); // 默认 .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true }); // .env.local 本地覆盖

export interface EnvConfig {
  dbUrl?: string;
  vectorDbUrl?: string;
  dashscopeApiKey?: string;
  dashscopeApiBase?: string;
  dashscopeModel?: string;

  langsmithApiKey?: string;
  langsmithTracing?: string;
  langchainProject?: string;
}

export function loadEnvConfig(): EnvConfig {
  return {
    dbUrl: process.env.DB_URL,
    vectorDbUrl: process.env.VECTOR_DB_URL,
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
    dashscopeApiBase: process.env.DASHSCOPE_API_BASE,
    dashscopeModel: process.env.DASHSCOPE_MODEL,
    
    langsmithApiKey: process.env.LANGSMITH_API_KEY,
    langsmithTracing: process.env.LANGSMITH_TRACING,
    langchainProject: process.env.LANGCHAIN_PROJECT
  };
}
