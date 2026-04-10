import dotenv from "dotenv";
import path from "path";

// 加载 .env 和 .env.local（local 覆盖，用于本地开发）
dotenv.config(); // 默认 .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true }); // .env.local 本地覆盖

function envFiniteNumber(key: string): number | undefined {
  const raw = process.env[key];
  if (raw === undefined || String(raw).trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export interface EnvConfig {

  dashscopeApiKey?: string;
  dashscopeApiBase?: string;
  dashscopeModel?: string;
  /** 采样温度，如 `DASHSCOPE_TEMPERATURE=0` */
  dashscopeTemperature?: number;
  /** DashScope 思考预算，如 `DASHSCOPE_THINKING_BUDGET=0` */
  dashscopeThinkingBudget?: number;
  dashscopeEnableThinking?: boolean;
  dashscopeJsonMode?: boolean;

  langsmithApiKey?: string;
  langsmithTracing?: string;
  langchainProject?: string;

  /** 入口模式：`cli`（默认）、`wecom`（企微，默认长连接）、`wecom-http`、`wecom-long` 等，见 `docs/channel-wecom.md` */
  channelMode?: string;

  wecomBotId?: string;
  wecomBotSecret?: string;
  wecomCorpId?: string;

  wecomAgentId?: string;
  wecomCorpSecret?: string;
  wecomWebhookKey?: string;
  wecomToken?: string;
  wecomEncodingAESKey?: string;
}

export function loadEnvConfig(): EnvConfig {
  return {

    dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
    dashscopeApiBase: process.env.DASHSCOPE_API_BASE,
    dashscopeModel: process.env.DASHSCOPE_MODEL,
    /** 优先 DASHSCOPE_TEMPERATURE，其次 LLM_TEMPERATURE / TEMPERATURE */
    dashscopeTemperature:
      envFiniteNumber("DASHSCOPE_TEMPERATURE") ??
      envFiniteNumber("LLM_TEMPERATURE") ??
      envFiniteNumber("TEMPERATURE"),
    dashscopeThinkingBudget: envFiniteNumber("DASHSCOPE_THINKING_BUDGET"),
    dashscopeEnableThinking: process.env.DASHSCOPE_ENABLE_THINKING === "true",
    dashscopeJsonMode: process.env.DASHSCOPE_JSON_MODE === "true",
    
    langsmithApiKey: process.env.LANGSMITH_API_KEY,
    langsmithTracing: process.env.LANGSMITH_TRACING,
    langchainProject: process.env.LANGCHAIN_PROJECT,

    channelMode: process.env.CHANNEL_MODE,

    wecomBotId: process.env.WECOM_BOT_ID,
    wecomBotSecret: process.env.WECOM_BOT_SECRET,
    wecomCorpId: process.env.WECOM_CORP_ID,
    
    wecomAgentId: process.env.WECOM_AGENT_ID,
    wecomCorpSecret: process.env.WECOM_CORP_SECRET,
    wecomWebhookKey: process.env.WECOM_WEBHOOK_KEY,
    wecomToken: process.env.WECOM_TOKEN,
    wecomEncodingAESKey: process.env.WECOM_ENCODING_AES_KEY,
  };
}


let envConfig: EnvConfig | null = null;
export function getEnvConfig(): EnvConfig {
  if (!envConfig) {
    envConfig = loadEnvConfig();
  }
  return envConfig;
}